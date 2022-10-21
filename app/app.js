var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
const awsIoT = require("aws-iot-device-sdk");
const bodyParser = require("body-parser");

var indexRouter = require("./routes/index");
var usersRouter = require("./routes/users");
const mysql = require("mysql");
const dbconfig = require("./config/database.js");
const connection = mysql.createConnection(dbconfig);

const app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

let deviceConnectFlag = false;

const device = awsIoT.device({
  keyPath: "config/IOT-2017243095.private.key",
  certPath: "config/IOT-2017243095.cert.pem",
  caPath: "config/root-CA.crt",
  clientId: "IOT-admin",
  host: "a4d3f7euhpzmk-ats.iot.ap-northeast-2.amazonaws.com",
  keepalive: 10,
});

device.on("connect", (connack) => {
  console.log("AWS IoT Connected");
  deviceConnectFlag = true;
  device.subscribe("Arduino/SendTempHumidityLog");
  device.subscribe("Arduino/RequestRfidVerify");
  device.subscribe("Arduino/Dust");
});

device.on("message", async (topic, payload) => {
  console.log("Received Topic: " + topic);
  console.log("Received Message: " + payload);
  payload = JSON.parse(payload);

  // Topic "Arduino/SendTempHumidityLog"가 입력되었을 때
  if (topic === "Arduino/SendTempHumidityLog") {
    connection.query(
      "INSERT INTO sensor_log (temp, humidity) VALUES (?,?)",
      [payload.temp, payload.humidity],
      (err) => {}
    );
  } else if (topic == "Arduino/RequestRfidVerify") {
    const rfidTag = payload.rfidTag;
    console.log(rfidTag);
    connection.query(
      "SELECT * FROM rfid WHERE tag = ?",
      [rfidTag],
      (err, rows) => {
        if (err) return;
        console.log(rows);
        if (rows.length == 0) {
          connection.query(
            "INSERT INTO rfid_log (tag, message, name) VALUES (?, ?, ?)",
            [rfidTag, "Not Registered Tag", null],
            (err) => {
              if (err) console.log(err);
            }
          );

          device.publish(
            "Arduino/ResponseRfidVerify",
            JSON.stringify({
              type: "rfid",
              result: 0,
            })
          );
        } else {
          rfid = rows[0];

          connection.query(
            "INSERT INTO rfid_log (tag, message, name) VALUES (?, ?, ?)",
            [rfidTag, "Success", rfid.name],
            (err) => {
              if (err) console.log(err);
            }
          );

          device.publish(
            "Arduino/ResponseRfidVerify",
            JSON.stringify({
              type: "rfid",
              result: 1,
            })
          );
        }
      }
    );
  } else if (topic == "Arduino/Dust") {
    console.log(payload);
    connection.query(
      "INSERT INTO dust_log (value) VALUES (?)",
      [payload.value],
      (err) => {}
    );
  }
});

device.on("close", (err) => {
  console.log("Device Close: " + err);
  deviceConnectFlag = false;
});

device.on("reconnect", () => {
  console.log("Device Reconnect");
  deviceConnectFlag = true;
});

device.on("offline", () => {
  console.log("Device Offline");
  deviceConnectFlag = false;
});

device.on("error", (err) => {
  console.log("Device Error: " + err);
  deviceConnectFlag = false;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/api/users", (req, res) => {
  connection.query("SELECT * FROM users", (err, rows) => {
    if (err) throw err;
    res.json({
      result: true,
      data: rows,
    });
  });
});

app.get("/api/sensor_logs", (req, res) => {
  connection.query(
    "SELECT * FROM sensor_log ORDER BY id DESC LIMIT 10",
    (err, rows) => {
      if (err) throw err;
      res.json({
        result: true,
        data: rows,
      });
    }
  );
});

app.get("/api/access_log", (req, res) => {
  connection.query(
    "SELECT * FROM rfid_log ORDER BY created_datetime DESC LIMIT 5",
    (err, rows) => {
      if (err) throw err;
      res.json({
        result: true,
        data: rows,
      });
    }
  );
});

app.post("/api/sensor_logs", (req, res) => {
  console.log(req.body);
  const temp = req.body.temp;
  const humidity = req.body.humidity;

  connection.query(
    "INSERT INTO sensor_log (temp, humidity) VALUES (?,?)",
    [temp, humidity],
    (err) => {
      if (err) {
        res.statusCode = 500;
        res.json({
          result: false,
          message: err.message,
        });
      } else {
        res.json({
          result: true,
          message: "Success",
        });
      }
    }
  );
});

app.delete("/api/rfid", (req, res) => {
  const tag = req.body.tag;
  connection.query(
    `DELETE FROM rfid WHERE tag = "${tag}"`,
    function (err, result) {
      if (err) throw err;
      if (err) {
        res.statusCode = 500;
        res.json({
          result: false,
          message: err.message,
        });
      } else {
        res.json({
          result: true,
          message: "Success",
        });
      }
    }
  );
});

app.put("/api/rfid", (req, res) => {
  const id = req.body.id;
  const tag = req.body.tag;
  const name = req.body.name;
  const card_number = req.body.card_number;

  const updateQuery = `SET tag = ${tag}, name = ${name}, card_number = ${card_number}`;

  connection.query(
    `UPDATE rfid ${updateQuery} WHERE id = ${id}`,
    function (err, result) {
      if (err) throw err;
      if (err) {
        res.statusCode = 500;
        res.json({
          result: false,
          message: err.message,
        });
      } else {
        res.json({
          result: true,
          message: "Success",
        });
      }
    }
  );
});

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/users", usersRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
