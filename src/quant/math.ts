export function toFinite(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function variance(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

export function stddev(values: number[]) {
  return Math.sqrt(Math.max(0, variance(values)));
}

export function last<T>(values: T[]) {
  return values[values.length - 1];
}

export function diff(values: number[]) {
  if (values.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] - values[i - 1]);
  }
  return out;
}

export function pctChange(values: number[], periods = 1) {
  if (values.length <= periods) return 0;
  const end = last(values);
  const start = values[values.length - 1 - periods];
  if (!(start > 0) || !Number.isFinite(end)) return 0;
  return (end - start) / start;
}

export function logReturns(values: number[]) {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const next = values[i];
    if (prev > 0 && next > 0) {
      out.push(Math.log(next / prev));
    }
  }
  return out;
}

export function ewmaVolatility(returns: number[], lambda = 0.94) {
  if (!returns.length) return 0;
  let varianceEstimate = returns[0] ** 2;
  for (let i = 1; i < returns.length; i += 1) {
    varianceEstimate = lambda * varianceEstimate + (1 - lambda) * returns[i] ** 2;
  }
  return Math.sqrt(Math.max(0, varianceEstimate));
}

export function linearSlope(values: number[]) {
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function zScore(value: number, values: number[]) {
  if (!values.length) return 0;
  const sigma = stddev(values);
  if (sigma === 0) return 0;
  return (value - mean(values)) / sigma;
}

export function maxDrawdownPct(values: number[]) {
  if (!values.length) return 0;
  let peak = values[0];
  let drawdown = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) {
      drawdown = Math.max(drawdown, (peak - value) / peak);
    }
  }
  return drawdown;
}

export function sigmoid(value: number) {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

export function round(value: number, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function tail(values: number[], maxItems: number) {
  if (maxItems <= 0) return [];
  return values.slice(Math.max(0, values.length - maxItems));
}
