const Bluebird = require("bluebird");
const fs = require("fs");

readTextFileAsync = Bluebird.promisify(function (params, cb) {
  fs.readFile(params, "UTF-8", cb);
});

readTextFileAsync("./main.js")
