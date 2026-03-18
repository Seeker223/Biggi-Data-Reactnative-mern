import mongoose from "mongoose";

const EmailEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    email: { type: String, default: "", index: true },
    type: { type: String, default: "generic", index: true },
  },
  { timestamps: true }
);

EmailEventSchema.index({ createdAt: -1 });

export default mongoose.model("EmailEvent", EmailEventSchema);
