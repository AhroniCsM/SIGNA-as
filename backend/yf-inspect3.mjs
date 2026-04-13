import YF from "yahoo-finance2";
const yf = new YF();
console.log("keys:", Object.keys(yf).slice(0,40));
console.log("proto:", Object.getOwnPropertyNames(Object.getPrototypeOf(yf)).slice(0,50));
