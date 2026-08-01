import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

const convex = new ConvexReactClient("https://quiet-trout-118.eu-west-1.convex.cloud");

createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={convex}>
    <App />
  </ConvexProvider>
);