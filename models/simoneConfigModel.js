import mongoose from "mongoose";

const simoneConfigSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "simone",
      unique: true,
      immutable: true,
    },
    apiKey: {
      type: String,
      required: true,
    },
    assistantId: {
      type: String,
    },
  },
  { timestamps: true }
);

const SimoneConfig = mongoose.model("SimoneConfig", simoneConfigSchema);
export default SimoneConfig;

