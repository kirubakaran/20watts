import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// WebXR requires a secure context, so the dev server runs over HTTPS.
// On a Quest, open https://<your-lan-ip>:5173 in the headset browser and
// accept the self-signed certificate once.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
});
