import { mount } from "svelte";
import "./lib/ui.css";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app")! });
