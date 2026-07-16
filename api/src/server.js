// server.js
require("dotenv").config();
const app = require("./app");

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`ShelfWise API listening on port ${port}`);
});
