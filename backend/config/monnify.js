import axios from "axios";

const MONNIFY_BASE_URL = process.env.MONNIFY_BASE_URL || "https://api.monnify.com";

export const monnifyAuth = async () => {
  const encoded = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`
  ).toString("base64");

  try {
    const response = await axios.post(
      `${MONNIFY_BASE_URL}/api/v1/auth/login`,
      {},
      {
        headers: {
          Authorization: `Basic ${encoded}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.responseBody.accessToken;
  } catch (error) {
    console.error("Monnify Auth Error:", error.response?.data || error);
    throw new Error("Failed to authenticate with Monnify");
  }
};
