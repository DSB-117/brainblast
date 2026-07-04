import mongoose from 'mongoose';

// Schema/index builder — the audited scope.
export function buildUserIndex() {
  const userSchema = new mongoose.Schema({
    email: { type: String, required: true },
  });
  // VULNERABLE: dropDups was removed in MongoDB 3.0 and is silently ignored by
  // Mongoose. The unique index is created but duplicate emails are NEVER dropped.
  userSchema.index({ email: 1 }, { unique: true, dropDups: true });
  return mongoose.model('User', userSchema);
}
