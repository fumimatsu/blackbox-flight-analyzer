import semver from "semver";
import React from "react";
import ReactDOM from "react-dom/client";
import "./vendor/log-core/jquery.js";
import { App } from "./app/App.jsx";
import "./styles/app.css";

globalThis.semver = semver;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
