import mongoose from 'mongoose';

const imageSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
  },
  imagePath: {
    type: String,
    required: true,
  },
  imageName: {
    type: String,
    required: true,
  },
  imageType: {
    type: String,
    required: true,
    enum: ['background', 'product', 'project', 'background-solid'],
    default: 'product',
  },
  syncS3: {
    type: Boolean,
    default: false,
  },
  model: {
    type: String,
    enum: ['GCP', 'SDXL', 'EditModel'],
  },
  backgroundRemoved: {
    type: Boolean,
    default: false,
  },
  parentImage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'image',
    default: null,
  },
  operations: {
    rotate: {
      type: Number,
      default: 0,
    },
    scale: {
      width: {
        type: Number,
        default: 1,
      },
      height: {
        type: Number,
        default: 1,
      },
    },
    position: {
      x: {
        type: Number,
        default: 0,
      },
      y: {
        type: Number,
        default: 0,
      },
    },
  },
  /** Set when an image is "deleted"; the row and underlying file are retained for restore / purge jobs. */
  deletedAt: {
    type: Date,
    default: null,
  },
});

imageSchema.set('timestamps', true);

imageSchema.index({ user: 1, deletedAt: 1 });

/** Exclude soft-deleted Image rows unless query opts pass { includeDeleted: true }. */
const SOFT_DELETE_QUERY_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'countDocuments',
];

imageSchema.pre(SOFT_DELETE_QUERY_HOOKS, function excludeSoftDeleted() {
  const opts = this.getOptions();
  if (opts?.includeDeleted) return;
  this.where({ deletedAt: null });
});

const Image = mongoose.model('Image', imageSchema);
export default Image;