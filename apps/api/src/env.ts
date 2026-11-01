/**
 * Must be the FIRST import of main.ts.
 *
 * Several modules read `process.env.*` at import time (for example the
 * multer upload limit). ConfigModule only loads `.env` later, when AppModule is
 * evaluated, so those values were silently ignored outside Docker. Loading the
 * file here fixes the ordering. Variables that are already set (Docker, systemd)
 * always win.
 */
try {
  process.loadEnvFile(process.env.ENV_FILE ?? ".env");
} catch {
  // No .env file: fine, the environment is provided by the runtime.
}
