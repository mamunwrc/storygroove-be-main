import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handlebars from 'handlebars';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTILS_DIR = __dirname;
const TEMPLATE_DIR = path.join(UTILS_DIR, 'template');
const ASSETS_DIR = path.join(UTILS_DIR, 'assets');

const REQUIRED_EMAIL_ENV = [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'NODE_MAILER_USER',
  'CLIENT_URL',
];

let transporter;

export class EmailDeliveryError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.cause = cause;
  }
}

export function assertEmailConfig() {
  const missing = REQUIRED_EMAIL_ENV.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length > 0) {
    throw new EmailDeliveryError(
      `Email is not configured (missing: ${missing.join(', ')})`
    );
  }
}

function resolveTemplatePath(template) {
  const fileName = path.basename(template);
  const templatePath = path.join(TEMPLATE_DIR, fileName);
  if (!fs.existsSync(templatePath)) {
    throw new EmailDeliveryError(`Email template not found: ${fileName}`);
  }
  return templatePath;
}

function assetPath(fileName) {
  return path.join(ASSETS_DIR, fileName);
}

function getTransporter() {
  assertEmailConfig();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

/** Verifies SMTP connectivity; call on startup in production. */
export async function verifyEmailTransport() {
  const transport = getTransporter();
  await transport.verify();
}

const sendEmail = async (email, subject, payload, template, ccRequired) => {
  void ccRequired;

  const templatePath = resolveTemplatePath(template);
  const source = fs.readFileSync(templatePath, 'utf8');

  const isVerificationTemplate = templatePath.endsWith('adminAprrovedNewUser.handlebars');
  const isResetPasswordTemplate = templatePath.endsWith('requestResetPassword.handlebars');
  const usesSocialIcons = isVerificationTemplate || isResetPasswordTemplate;
  const welcomeEmailImageCid = 'welcome-email-image';
  const facebookImageCid = 'facebook-image';
  const twitterImageCid = 'twitter-image';
  const instagramImageCid = 'instagram-image';
  const linkedInImageCid = 'linkedin-image';
  const whiteDownImageCid = 'white-down-image';

  const templatePayload = {
    ...payload,
    ...(usesSocialIcons
      ? {
          facebookImageSrc: `cid:${facebookImageCid}`,
          twitterImageSrc: `cid:${twitterImageCid}`,
          instagramImageSrc: `cid:${instagramImageCid}`,
          linkedInImageSrc: `cid:${linkedInImageCid}`,
        }
      : {}),
    ...(isVerificationTemplate
      ? {
          welcomeEmailImageSrc: `cid:${welcomeEmailImageCid}`,
          whiteDownImageSrc: `cid:${whiteDownImageCid}`,
        }
      : {}),
    ...(isResetPasswordTemplate
      ? {
          resetPasswordImageSrc: `cid:${welcomeEmailImageCid}`,
        }
      : {}),
  };

  const compiledTemplate = handlebars.compile(source);
  const htmlToSend = compiledTemplate(templatePayload);

  const mailOptions = {
    from: `"StoryGroove Support Team" <${process.env.NODE_MAILER_USER}>`,
    to: email,
    subject,
    html: htmlToSend,
  };

  if (usesSocialIcons || isVerificationTemplate) {
    const attachments = [];

    if (usesSocialIcons) {
      attachments.push(
        { filename: 'facebook2x.png', path: assetPath('facebook2x.png'), cid: facebookImageCid },
        { filename: 'twitter2x.png', path: assetPath('twitter2x.png'), cid: twitterImageCid },
        { filename: 'instagram2x.png', path: assetPath('instagram2x.png'), cid: instagramImageCid },
        { filename: 'linkedin2x.png', path: assetPath('linkedin2x.png'), cid: linkedInImageCid }
      );
    }

    if (isVerificationTemplate) {
      attachments.push(
        { filename: 'Welcome_Email.png', path: assetPath('Welcome_Email.png'), cid: welcomeEmailImageCid },
        { filename: 'white_down.png', path: assetPath('white_down.png'), cid: whiteDownImageCid }
      );
    }

    if (isResetPasswordTemplate) {
      attachments.push({
        filename: 'Welcome_Email.png',
        path: assetPath('Welcome_Email.png'),
        cid: welcomeEmailImageCid,
      });
    }

    mailOptions.attachments = attachments;
  }

  try {
    const info = await getTransporter().sendMail(mailOptions);
    console.log(`[email] Sent "${subject}" to ${email} (messageId=${info.messageId || 'n/a'})`);
    return info;
  } catch (error) {
    console.error(`[email] Failed to send "${subject}" to ${email}:`, error.message);
    throw new EmailDeliveryError(
      `Failed to send email (${error.code || error.message})`,
      error
    );
  }
};

export async function sendVerificationEmail({ email, name, verifyLink }) {
  return sendEmail(
    email,
    'Verify your email address.',
    { name, email, verifylink: verifyLink },
    'adminAprrovedNewUser.handlebars',
    false
  );
}

export default sendEmail;
