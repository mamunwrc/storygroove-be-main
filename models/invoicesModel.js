import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    invoiceId: {
        type: String,
        required: true
    },
    invoiceTimestamp: {
        type: Date,
        required: true
    },
    invoiceAmount: {
        type: Number,
        required: true
    },
    customerName: {
        type: String,
        required: false
    },
    customerEmail: {
        type: String,
        required: true
    },
    downloadUrl: {
        type: String,
        required: false
    },
    status: {
        type: String,
        required: false
    }

}, {
    timestamps: true
    });

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;