import express from "express";
import fileUpload from "express-fileupload";

export function withUploads(app: express.Express) {
  // FIXED: safeFileNames: true strips path separators and special characters from filenames.
  app.use(fileUpload({ safeFileNames: true, preserveExtension: true }));
  return app;
}
