import yf from "yahoo-finance2";
console.log("default type:", typeof yf);
console.log("chart?", typeof yf.chart);
console.log("historical?", typeof yf.historical);
console.log("quote?", typeof yf.quote);
console.log("own:", Object.getOwnPropertyNames(yf).slice(0,30));
console.log("proto:", Object.getOwnPropertyNames(Object.getPrototypeOf(yf)).slice(0,40));
