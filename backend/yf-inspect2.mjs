import yf from "yahoo-finance2";
const inst = yf();
console.log("inst type:", typeof inst);
console.log("inst keys:", Object.keys(inst).slice(0,30));
console.log("chart?", typeof inst.chart);
console.log("historical?", typeof inst.historical);
console.log("quote?", typeof inst.quote);
