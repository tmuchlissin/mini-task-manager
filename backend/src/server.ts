import { app } from "./app.js";

// The port can be changed through backend/.env for local or hosted runs.
const port = Number(process.env.PORT ?? 3001);

// app contains the Express configuration; this file only starts the server.
app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
