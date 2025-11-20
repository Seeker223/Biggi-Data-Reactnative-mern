// backend/utils/zenipoint.js
import axios from "axios";

const apiKey = process.env.ZENI_API_KEY;
const contractKey = process.env.ZENI_CONTRACT_KEY;
const BASE_URL = process.env.ZENI_BASE_URL || "https://api.zenipoint.com/v1";

// Encode credentials
const authHeader = "Basic " + Buffer.from(`${apiKey}:${contractKey}`).toString("base64");

// Axios instance
export const zenipoint = axios.create({
  baseURL: BASE_URL,
  timeout: 20000, // 20s timeout
  headers: {
    Authorization: authHeader,
    "Content-Type": "application/json",
  },
});

/**
 * POST helper with network error fallback
 * Retries once if network fails
 */
export const zenipointPost = async (endpoint, data) => {
  // If keys missing, simulate local dev mode
  if (!apiKey || !contractKey) {
    return {
      data: {
        mode: "LOCAL_TEST_MODE",
        status: "success",
        message: "Zenipoint transaction simulated (dev mode)",
        data,
      },
    };
  }

  try {
    const res = await zenipoint.post(endpoint, data);
    return res;
  } catch (err) {
    console.error("Zenipoint API ERROR:", err.message || err.response?.data);

    // Retry once if network error
    if (err.code === "ENOTFOUND" || err.code === "ECONNABORTED") {
      console.warn("Retrying Zenipoint API call...");
      try {
        const retryRes = await zenipoint.post(endpoint, data);
        return retryRes;
      } catch (retryErr) {
        console.error("Zenipoint Retry Failed:", retryErr.message || retryErr.response?.data);
        throw retryErr;
      }
    }

    throw err; // Let controller handle refund
  }
};

/**
 * Generate unique reference for transactions
 * Format: BD + timestamp + random 6-digit
 */
export const generateReference = () =>
  "BD" + Date.now() + Math.floor(Math.random() * 999999);
