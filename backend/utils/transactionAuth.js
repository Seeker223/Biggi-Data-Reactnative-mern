const consumeBiometricProof = (user, token, expectedAction, expectedAmount = 0) => {
  const biometric = user?.biometricAuth || {};
  if (!biometric.enabled) return { ok: false, message: "Biometric authentication not enabled" };
  if (!token) {
    return { ok: false, message: "Biometric verification is required for this transaction" };
  }

  const proofs = Array.isArray(biometric.transactionProofs) ? biometric.transactionProofs : [];
  const now = Date.now();
  const proof = proofs.find((item) => item.token === token);
  if (!proof) {
    return { ok: false, message: "Invalid biometric proof. Please verify again." };
  }
  if (proof.usedAt) {
    return { ok: false, message: "Biometric proof already used. Verify again." };
  }
  if (!proof.expiresAt || new Date(proof.expiresAt).getTime() < now) {
    return { ok: false, message: "Biometric proof expired. Verify again." };
  }
  if (expectedAction && proof.action && proof.action !== expectedAction) {
    return { ok: false, message: "Biometric proof action mismatch. Verify again." };
  }
  const reqAmount = Number(expectedAmount || 0);
  const proofAmount = Number(proof.amount || 0);
  if (reqAmount > 0 && proofAmount > 0 && reqAmount !== proofAmount) {
    return { ok: false, message: "Biometric proof amount mismatch. Verify again." };
  }

  proof.usedAt = new Date();
  user.biometricAuth.transactionProofs = proofs.slice(0, 20);
  return { ok: true, method: "biometric" };
};

export const verifyTransactionAuthorization = async ({
  user,
  expectedAction,
  expectedAmount = 0,
  biometricProof = "",
  transactionPin = "",
}) => {
  const hasPin = Boolean(user?.transactionPinHash);
  const biometricEnabled = Boolean(user?.biometricAuth?.enabled);
  const pin = String(transactionPin || "").trim();
  const proof = String(biometricProof || "").trim();

  // If caller supplied a PIN but account has no PIN configured, reject.
  // This prevents false-positive "success" when users think PIN is being validated.
  if (pin && !hasPin) {
    return {
      ok: false,
      message: "Transaction PIN is not enabled for this account.",
    };
  }

  // If caller supplied biometric proof but biometric is not enabled, reject.
  if (proof && !biometricEnabled) {
    return {
      ok: false,
      message: "Biometric authentication is not enabled for this account.",
    };
  }

  if (!hasPin && !biometricEnabled) {
    // Allow no-auth mode only when no security credential was supplied.
    if (!pin && !proof) {
      return { ok: true, method: "none" };
    }
    return {
      ok: false,
      message: "Transaction security is not configured on this account.",
    };
  }

  if (pin) {
    if (!/^\d{4}$/.test(pin)) {
      return { ok: false, message: "Transaction PIN must be exactly 4 digits." };
    }
    const pinOk = await user.matchTransactionPin(pin);
    if (!pinOk) {
      return { ok: false, message: "Invalid transaction PIN." };
    }
    return { ok: true, method: "pin" };
  }

  if (biometricEnabled) {
    return consumeBiometricProof(user, proof, expectedAction, expectedAmount);
  }

  if (hasPin) {
    return { ok: false, message: "Transaction PIN is required for this action." };
  }

  return { ok: false, message: "Biometric verification is required for this transaction." };
};
