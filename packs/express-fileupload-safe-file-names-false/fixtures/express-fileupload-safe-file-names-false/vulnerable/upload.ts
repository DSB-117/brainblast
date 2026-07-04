import express from "express";
import fileUpload from "express-fileupload";

export function withUploads(app: express.Express) {
  // VULNERABLE: safeFileNames: false keeps raw filenames (../, separators) — path traversal on mv().
  app.use(fileUpload({ safeFileNames: false, preserveExtension: true }));
  return app;
}
