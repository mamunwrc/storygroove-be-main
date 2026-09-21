import mongoose from "mongoose";
import { type } from "os";

const ReviewPillarSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
    },
    pillar: {
      type: String,
      enum: ["evaluation", "development", "line", "copyedit"],
    },
    response: { type: String, required: true },
    actNumber: { type: Number },
    sceneIndex: { type: Number },
  },
  { timestamps: true }
);

const ReviewPillar = mongoose.model("ReviewPillars", ReviewPillarSchema);
export default ReviewPillar;
