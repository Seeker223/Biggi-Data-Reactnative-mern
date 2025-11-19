// backend/utils/zenipoint.js
import axios from "axios";

const BASE_URL = process.env.ZENI_BASE_URL || "https://zenipoint.com/api";
const LIVE = process.env.ZENI_LIVE === "true";

export const generateReference = () =>
  "BD" + Date.now() + Math.floor(Math.random() * 999999);

export const zenipointPost = async (endpoint, payload) => {
  if (!LIVE) {
    // LOCAL SIMULATION MODE
    return {
      data: {
        status: "success",
        code: 200,
        message: `[LOCAL TEST MODE] Simulated purchase OK`,
        payload,
      },
    };
  }

  const apiKey = process.env.ZENI_API_KEY;
  const contractKey = process.env.ZENI_CONTRACT_KEY;

  const authKey = Buffer.from(`${apiKey}:${contractKey}`).toString("base64");

  try {
    return await axios.post(`${BASE_URL}${endpoint}`, payload, {
      headers: {
        Authorization: `Basic ${authKey}`,
        "Content-Type": "application/json",
      },
      timeout: 12000,
    });
  } catch (err) {
    console.error("ZENIPOINT ERROR:", err.response?.data || err.message);
    throw err;
  }
};
