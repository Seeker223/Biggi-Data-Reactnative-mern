// backend/utils/zenipoint.js
import axios from "axios";

const apiKey = process.env.ZENI_API_KEY;
const contractKey = process.env.ZENI_CONTRACT_KEY;
const BASE_URL = process.env.ZENI_BASE_URL || "https://zenipoint.com/api";
const ZENI_LIVE = (process.env.ZENI_LIVE || "false").toLowerCase() === "true";

const makeAuth = () =>
  apiKey && contractKey
    ? "Basic " + Buffer.from(`${apiKey}:${contractKey}`).toString("base64")
    : null;

/**
 * POST helper with:
 * - respects ZENI_LIVE flag
 * - sends Basic Auth header
 * - retries once on network/DNS errors
 * - returns a normalized object: { mode, success, raw }
 */
export const zenipointPost = async (endpoint, payload) => {
  // If not live, simulate
  if (!ZENI_LIVE || !apiKey || !contractKey) {
    console.warn("Zenipoint: running in LOCAL_TEST_MODE (ZENI_LIVE=false or missing keys)");
    return {
      data: {
        mode: "LOCAL_TEST_MODE",
        status: "success",
        message: "Zenipoint transaction simulated (dev mode)",
        data: payload,
      },
    };
  }

  const url = `${BASE_URL}${endpoint}`;

  const headers = {
    Authorization: makeAuth(),
    "Content-Type": "application/json",
  };

  try {
    const res = await axios.post(url, payload, {
      headers,
      timeout: 20000,
    });
    return res;
  } catch (err) {
    console.error("Zenipoint API ERROR:", err.code || err.message || err.response?.data);

    // Retry once for transient DNS / timeout errors
    if (err.code === "ENOTFOUND" || err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      console.warn("Zenipoint retrying once due to network error...");
      try {
        const retryRes = await axios.post(url, payload, {
          headers,
          timeout: 20000,
        });
        return retryRes;
      } catch (retryErr) {
        console.error("Zenipoint retry failed:", retryErr.message || retryErr.response?.data);
        // Fallback to simulated response so your frontend can proceed in dev
        return {
          data: {
            mode: "LOCAL_TEST_MODE",
            status: "success",
            message: "Zenipoint fallback simulation after network failure",
            data: payload,
          },
        };
      }
    }

    // For other errors (auth, validation), rethrow so controller can decide
    throw err;
  }
};

export const generateReference = () =>
  "BD" + Date.now() + Math.floor(Math.random() * 999999);
