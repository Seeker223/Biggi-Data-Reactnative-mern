import axios from "axios";

const BASE_URL = "https://api.zenipoint.com/v1";
const API_KEY = process.env.ZENI_API_KEY;
const CONTRACT_KEY = process.env.ZENI_CONTRACT_KEY;

const auth = "Basic " + Buffer.from(`${API_KEY}:${CONTRACT_KEY}`).toString("base64");

axios.post(`${BASE_URL}/data/buy`, {
  mobile_no: "08132194046",
  plan_id: "MTN1GBSME",
  reference: "BD" + Date.now()
}, {
  headers: { Authorization: auth }
})
.then(res => console.log(res.data))
.catch(err => console.error(err.message));
