import mongoose from 'mongoose';

// Schema/index builder — the audited scope.
export function buildUserIndex() {
  const userSchema = new mongoose.Schema({
    email: { type: String, required: true },
  });
  // FIXED: dropDups:false — do not rely on the removed/ignored dedup flag.
  // Uniqueness is enforced by the real unique index; dups are removed manually.
  userSchema.index({ email: 1 }, { unique: true, dropDups: false });
  return mongoose.model('User', userSchema);
}
