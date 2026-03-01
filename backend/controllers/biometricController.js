import crypto from "crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import User from "../models/User.js";

const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://biggidata.com.ng",
  "https://www.biggidata.com.ng",
];

const sanitizeHost = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();

const getHostFromOrigin = (origin = "") => {
  try {
    return sanitizeHost(new URL(origin).hostname);
  } catch {
    return "";
  }
};

const base64urlToBuffer = (value = "") => {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
};

const bufferToBase64url = (value) => {
  if (!value) return "";
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const getWebAuthnConfig = (req) => {
  const expectedOrigins = (process.env.WEBAUTHN_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const resolvedOrigins = expectedOrigins.length > 0 ? expectedOrigins : DEFAULT_ORIGINS;

  const configuredRpID = sanitizeHost(process.env.WEBAUTHN_RP_ID || "");
  const originHost = getHostFromOrigin(req.headers?.origin || "");
  const requestHost = sanitizeHost(req.hostname || "");

  const customOriginHost =
    resolvedOrigins
      .map((origin) => getHostFromOrigin(origin))
      .find(
        (host) =>
          host &&
          !["localhost", "127.0.0.1"].includes(host) &&
          !host.endsWith(".onrender.com")
      ) || "";

  const rpID =
    configuredRpID ||
    (originHost && !originHost.endsWith(".onrender.com") ? originHost : "") ||
    customOriginHost ||
    requestHost ||
    "localhost";

  return {
    rpName: process.env.WEBAUTHN_RP_NAME || "Biggi Data",
    rpID,
    expectedOrigins: resolvedOrigins,
  };
};

const normalizeIdentifier = (value = "") => String(value || "").trim();

const findUserForLogin = async (identifier) => {
  const clean = normalizeIdentifier(identifier);
  if (!clean) return null;

  const lower = clean.toLowerCase();
  const byEmail = await User.findOne({ email: lower });
  if (byEmail) return byEmail;

  return User.findOne({
    username: { $regex: `^${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
};

const sanitizeUserPayload = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  phoneNumber: user.phoneNumber,
  age: user.age,
  isVerified: true,
  role: user.role,
  userRole: user.userRole || null,
  state: user.state,
  referralCode: user.referralCode,
  referredByCode: user.referredByCode,
  mainBalance: user.mainBalance,
  rewardBalance: user.rewardBalance,
  notifications: user.notifications || 0,
  biometricEnabled: Boolean(user.biometricAuth?.enabled),
});

export const getBiometricStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("biometricAuth.enabled biometricAuth.credentials");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      biometric: {
        enabled: Boolean(user.biometricAuth?.enabled),
        credentialsCount: Array.isArray(user.biometricAuth?.credentials)
          ? user.biometricAuth.credentials.length
          : 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch biometric status" });
  }
};

export const beginBiometricRegistration = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const { rpName, rpID } = getWebAuthnConfig(req);
    const credentials = user.biometricAuth?.credentials || [];

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.username,
      userID: isoUint8Array.fromUTF8String(user._id.toString()),
      timeout: 60000,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: credentials.map((cred) => ({
        id: base64urlToBuffer(cred.credentialID),
        type: "public-key",
        transports: cred.transports || [],
      })),
    });

    user.biometricAuth = user.biometricAuth || {};
    user.biometricAuth.registrationChallenge = options.challenge;
    user.biometricAuth.registrationChallengeExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, options });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to start biometric registration",
    });
  }
};

export const verifyBiometricRegistration = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const challenge = user.biometricAuth?.registrationChallenge;
    const challengeExpiry = user.biometricAuth?.registrationChallengeExpiresAt;
    if (!challenge || !challengeExpiry || challengeExpiry.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "Registration challenge expired. Try again." });
    }

    const { rpID, expectedOrigins } = getWebAuthnConfig(req);
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ success: false, message: "Biometric registration verification failed" });
    }

    const info = verification.registrationInfo;
    const credentialID = bufferToBase64url(info.credential?.id || info.credentialID);
    const publicKey = bufferToBase64url(info.credential?.publicKey || info.credentialPublicKey);
    const counter = Number(info.credential?.counter ?? info.counter ?? 0);
    const transports = req.body?.response?.transports || [];
    const deviceType = info.credentialDeviceType || "singleDevice";
    const backedUp = Boolean(info.credentialBackedUp);

    const creds = Array.isArray(user.biometricAuth?.credentials) ? user.biometricAuth.credentials : [];
    const existing = creds.find((cred) => cred.credentialID === credentialID);

    if (existing) {
      existing.publicKey = publicKey;
      existing.counter = counter;
      existing.transports = transports;
      existing.deviceType = deviceType;
      existing.backedUp = backedUp;
      existing.lastUsedAt = new Date();
    } else {
      creds.push({
        credentialID,
        publicKey,
        counter,
        transports,
        deviceType,
        backedUp,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });
    }

    user.biometricAuth.credentials = creds;
    user.biometricAuth.enabled = true;
    user.biometricAuth.registrationChallenge = null;
    user.biometricAuth.registrationChallengeExpiresAt = null;
    user.addNotification({
      type: "Security",
      status: "success",
      message: "Fingerprint login enabled successfully.",
    });
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: "Biometric registration successful",
      biometric: {
        enabled: true,
        credentialsCount: creds.length,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to verify biometric registration",
    });
  }
};

export const beginBiometricLogin = async (req, res) => {
  try {
    const identifier = normalizeIdentifier(req.body?.identifier);
    if (!identifier) {
      return res.status(400).json({ success: false, message: "Email or username is required" });
    }

    const user = await findUserForLogin(identifier);
    if (!user || !user.biometricAuth?.enabled || !(user.biometricAuth?.credentials || []).length) {
      return res.status(404).json({ success: false, message: "Biometric login is not enabled for this account" });
    }

    const { rpID } = getWebAuthnConfig(req);
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60000,
      userVerification: "preferred",
      allowCredentials: (user.biometricAuth.credentials || []).map((cred) => ({
        id: base64urlToBuffer(cred.credentialID),
        type: "public-key",
        transports: cred.transports || [],
      })),
    });

    user.biometricAuth.authenticationChallenge = options.challenge;
    user.biometricAuth.authenticationChallengeExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, options });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to start biometric login",
    });
  }
};

export const verifyBiometricLogin = async (req, res) => {
  try {
    const identifier = normalizeIdentifier(req.body?.identifier);
    const user = await findUserForLogin(identifier);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const challenge = user.biometricAuth?.authenticationChallenge;
    const challengeExpiry = user.biometricAuth?.authenticationChallengeExpiresAt;
    if (!challenge || !challengeExpiry || challengeExpiry.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "Authentication challenge expired. Try again." });
    }

    const credentialID = req.body?.id;
    const authenticator = (user.biometricAuth?.credentials || []).find(
      (cred) => cred.credentialID === credentialID
    );
    if (!authenticator) {
      return res.status(400).json({ success: false, message: "Biometric credential not recognized" });
    }

    const { rpID, expectedOrigins } = getWebAuthnConfig(req);
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      requireUserVerification: true,
      authenticator: {
        credentialID: base64urlToBuffer(authenticator.credentialID),
        credentialPublicKey: base64urlToBuffer(authenticator.publicKey),
        counter: Number(authenticator.counter || 0),
        transports: authenticator.transports || [],
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ success: false, message: "Biometric login verification failed" });
    }

    authenticator.counter = verification.authenticationInfo?.newCounter ?? authenticator.counter;
    authenticator.lastUsedAt = new Date();
    user.biometricAuth.authenticationChallenge = null;
    user.biometricAuth.authenticationChallengeExpiresAt = null;
    user.lastLogin = new Date();
    user.addNotification({
      type: "Welcome",
      status: "success",
      message: `Welcome back, ${user.username}!`,
    });
    await user.save({ validateBeforeSave: false });

    const accessToken = user.getSignedJwtToken();
    const refreshToken = user.getRefreshToken();
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      token: accessToken,
      refreshToken,
      user: sanitizeUserPayload(user),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to verify biometric login",
    });
  }
};

export const beginBiometricTransaction = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!user.biometricAuth?.enabled || !(user.biometricAuth?.credentials || []).length) {
      return res.status(400).json({ success: false, message: "Biometric authentication not enabled" });
    }

    const action = String(req.body?.action || "transaction").trim().toLowerCase();
    const amount = Number(req.body?.amount || 0);
    const { rpID } = getWebAuthnConfig(req);

    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60000,
      userVerification: "preferred",
      allowCredentials: (user.biometricAuth.credentials || []).map((cred) => ({
        id: base64urlToBuffer(cred.credentialID),
        type: "public-key",
        transports: cred.transports || [],
      })),
    });

    user.biometricAuth.transactionChallenge = options.challenge;
    user.biometricAuth.transactionChallengeExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    user.biometricAuth.transactionContext = {
      action,
      amount,
      createdAt: new Date(),
    };
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, options });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to start biometric transaction verification",
    });
  }
};

export const verifyBiometricTransaction = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const challenge = user.biometricAuth?.transactionChallenge;
    const challengeExpiry = user.biometricAuth?.transactionChallengeExpiresAt;
    if (!challenge || !challengeExpiry || challengeExpiry.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "Transaction challenge expired. Try again." });
    }

    const credentialID = req.body?.id;
    const authenticator = (user.biometricAuth?.credentials || []).find(
      (cred) => cred.credentialID === credentialID
    );
    if (!authenticator) {
      return res.status(400).json({ success: false, message: "Biometric credential not recognized" });
    }

    const { rpID, expectedOrigins } = getWebAuthnConfig(req);
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      requireUserVerification: true,
      authenticator: {
        credentialID: base64urlToBuffer(authenticator.credentialID),
        credentialPublicKey: base64urlToBuffer(authenticator.publicKey),
        counter: Number(authenticator.counter || 0),
        transports: authenticator.transports || [],
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ success: false, message: "Biometric transaction verification failed" });
    }

    authenticator.counter = verification.authenticationInfo?.newCounter ?? authenticator.counter;
    authenticator.lastUsedAt = new Date();
    user.biometricAuth.transactionChallenge = null;
    user.biometricAuth.transactionChallengeExpiresAt = null;

    const context = user.biometricAuth.transactionContext || {};
    const proofToken = crypto.randomBytes(24).toString("hex");
    const now = new Date();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const proofs = Array.isArray(user.biometricAuth.transactionProofs)
      ? user.biometricAuth.transactionProofs
      : [];

    proofs.unshift({
      token: proofToken,
      action: context.action || "transaction",
      amount: Number(context.amount || 0),
      createdAt: now,
      expiresAt,
      usedAt: null,
    });
    user.biometricAuth.transactionProofs = proofs.slice(0, 20);
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      proofToken,
      expiresAt,
      context: {
        action: context.action || "transaction",
        amount: Number(context.amount || 0),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to verify biometric transaction",
    });
  }
};

export const disableBiometric = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.biometricAuth = {
      enabled: false,
      registrationChallenge: null,
      registrationChallengeExpiresAt: null,
      authenticationChallenge: null,
      authenticationChallengeExpiresAt: null,
      transactionChallenge: null,
      transactionChallengeExpiresAt: null,
      transactionContext: null,
      transactionProofs: [],
      credentials: [],
    };
    user.addNotification({
      type: "Security",
      status: "info",
      message: "Fingerprint login disabled.",
    });
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, message: "Biometric authentication disabled" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to disable biometric authentication" });
  }
};
