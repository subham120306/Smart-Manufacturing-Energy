/**
 * Factory Energy & Process Efficiency — SME Monitor
 * Self-contained bundle (NO ES Module CORS restrictions)
 * Runs directly on file:/// or http:// or any static host.
 */
(function() {
  'use strict';

  // Plant-wide configuration & constants
  const CONFIG = {
    APP_TITLE: "Factory Energy & Process Efficiency — SME Monitor",
    TARIFF_INR_PER_KWH: 8.5,
    CO2_KG_PER_KWH: 0.71,
    PRODUCT_TONNES_PER_UNIT: 0.005, // 5 kg = 0.005 tonnes
    CONTRACT_DEMAND_KVA: 50.0,
    DEMAND_CHARGE_INR_PER_KVA: 350.0,
    PF_BENCHMARK: 0.95,
    PF_PENALTY_PCT_PER_0_01: 1.0,
    PF_REBATE_PCT_PER_0_01: 0.5,
    PF_REBATE_CAP_PCT: 2.5,
    TEMP_WARN_C: 72.0,
    TEMP_CRIT_C: 85.0,
    VIB_WARN_MM_S: 4.5,
    VIB_CRIT_MM_S: 7.1,
    SOLAR_PEAK_FACTOR: 0.59,
    BEE_BENCHMARK_KWH_PER_UNIT: {
      M1: { "5_star": 0.080, "3_star": 0.115, name: "CNC Lathe" },
      M2: { "5_star": 0.050, "3_star": 0.075, name: "Injection Molder" },
      M3: { "5_star": 0.065, "3_star": 0.095, name: "Hydraulic Press" },
      M4: { "5_star": 0.000, "3_star": 0.000, name: "Air Compressor" },
      M5: { "5_star": 0.010, "3_star": 0.018, name: "Conveyor Line" },
      M6: { "5_star": 0.090, "3_star": 0.130, name: "Welding Robot" },
    },
    TOU_MULTIPLIER: {
      "Off-peak": 0.85,
      "Normal": 1.00,
      "Peak": 1.20,
    },
    TOU_COLOR: {
      "Off-peak": "#15803d",
      "Normal": "#d96b43",
      "Peak": "#b91c1c",
    },
    COLOR: {
      Healthy: "#15803d",
      Warning: "#b45309",
      Critical: "#b91c1c",
      accent: "#c85a32",
      charcoal: "#1c1917",
    },
    FUELS: {
      Diesel: { co2: 0.27, price: 9.0 },
      LPG: { co2: 0.23, price: 8.0 },
      Coal: { co2: 0.34, price: 2.0 },
      "Natural gas": { co2: 0.20, price: 6.0 },
    },
    FUEL_TARGETS: ["Electric heat pump", "Biomass boiler"],
    FLEX_DEFAULT: { M1: 0.10, M2: 0.40, M3: 0.30, M4: 0.25, M5: 0.0, M6: 0.20 },
  };

  const MACHINES = [
    { id: "M1", name: "CNC Lathe", base_kw: 4.0, units_per_hour: 42, bay: "Bay 1 — Precision Machining", icon: "⚙️" },
    { id: "M2", name: "Injection Molder", base_kw: 7.5, units_per_hour: 120, bay: "Bay 1 — Molding & Tooling", icon: "🏭" },
    { id: "M3", name: "Hydraulic Press", base_kw: 5.2, units_per_hour: 65, bay: "Bay 1 — Heavy Press", icon: "🔨" },
    { id: "M4", name: "Air Compressor", base_kw: 9.0, units_per_hour: 0, bay: "Bay 2 — Utilities & Pneumatics", icon: "💨" },
    { id: "M5", name: "Conveyor Line", base_kw: 2.4, units_per_hour: 200, bay: "Bay 2 — Central Transfer Line", icon: "📦" },
    { id: "M6", name: "Welding Robot", base_kw: 6.1, units_per_hour: 55, bay: "Bay 2 — Robotic Assembly", icon: "🤖" },
  ];

  const MACHINE_MAP = Object.fromEntries(MACHINES.map(m => [m.id, m]));
  const DEGRADING = { M3: 1.9, M4: 1.35 };

  class SeededRandom {
    constructor(seed = 42) {
      this.seed = seed;
    }
    next() {
      this.seed = (this.seed * 9301 + 49297) % 233280;
      return this.seed / 233280;
    }
    normal(mean = 0, stdev = 1) {
      const u1 = Math.max(1e-10, this.next());
      const u2 = this.next();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      return mean + z * stdev;
    }
  }

  let rng = new SeededRandom(7);

  function resetRng(seed = 7) {
    rng = new SeededRandom(seed);
  }

  function bandOfHour(hour) {
    const h = (hour + 24) % 24;
    if ((h >= 22 && h <= 23) || (h >= 0 && h < 6)) return "Off-peak";
    if (h >= 18 && h < 22) return "Peak";
    return "Normal";
  }

  function shiftFactor(hour) {
    if (hour >= 6 && hour < 14) return 1.0;
    if (hour >= 14 && hour < 22) return 0.92;
    return 0.35;
  }

  function generateHistory(hours = 72, freqMin = 5) {
    resetRng(42);
    const now = new Date();
    now.setMinutes(Math.floor(now.getMinutes() / freqMin) * freqMin, 0, 0);

    const startTime = new Date(now.getTime() - hours * 3600 * 1000);
    const totalTicks = Math.floor((hours * 60) / freqMin) + 1;
    const rows = [];

    for (const m of MACHINES) {
      const mid = m.id;
      const rampMax = DEGRADING[mid] || 0.0;

      for (let i = 0; i < totalTicks; i++) {
        const ts = new Date(startTime.getTime() + i * freqMin * 60 * 1000);
        const hour = ts.getHours();
        const shift = shiftFactor(hour);
        const ramp = (i / totalTicks) * rampMax;

        let kw = m.base_kw * shift * (1 + rng.normal(0, 0.035)) + ramp;
        kw = Math.max(0.15, kw);

        const isSpike = rng.next() < 0.005;
        if (isSpike) {
          kw *= (1.4 + rng.next() * 0.5);
        }

        const voltage = 415 + rng.normal(0, 3.2) - ramp * 2;
        const power_factor = Math.min(0.99, Math.max(0.60, 0.94 - ramp * 0.06 + rng.normal(0, 0.012)));
        const current = (kw * 1000) / (Math.sqrt(3) * voltage * power_factor);

        let temperature = 45 + 18 * shift + ramp * 9 + rng.normal(0, 1.3);
        let vibration = 1.8 + 1.1 * shift + ramp * 2.2 + rng.normal(0, 0.12);
        if (isSpike) vibration *= 1.3;

        const running = shift > 0.5;
        let units = running ? m.units_per_hour * (freqMin / 60) * Math.max(0, 1 + rng.normal(0, 0.06)) : 0;
        units = Math.max(0, units);

        rows.push({
          ts,
          machine_id: mid,
          machine: m.name,
          voltage_v: voltage,
          current_a: current,
          power_factor: power_factor,
          power_kw: kw,
          energy_kwh: kw * (freqMin / 60),
          temperature_c: temperature,
          vibration_mm_s: vibration,
          units_produced: units,
          running: running,
        });
      }
    }

    rows.sort((a, b) => a.ts - b.ts);
    return rows;
  }

  function liveTick(history, freqMin = 5) {
    const lastTs = history.reduce((max, r) => (r.ts > max ? r.ts : max), history[0].ts);
    const nextTs = new Date(lastTs.getTime() + freqMin * 60 * 1000);
    const hour = nextTs.getHours();
    const shift = shiftFactor(hour);
    const newRows = [];

    for (const m of MACHINES) {
      const mid = m.id;
      const ramp = DEGRADING[mid] || 0.0;
      let kw = Math.max(0.15, m.base_kw * shift * (1 + rng.normal(0, 0.05)) + ramp);
      const isSpike = rng.next() < 0.05;
      if (isSpike) kw *= 1.6;

      const voltage = 415 + rng.normal(0, 3.0) - ramp * 2;
      const power_factor = Math.min(0.99, Math.max(0.60, 0.94 - ramp * 0.06 + rng.normal(0, 0.015)));
      const current = (kw * 1000) / (Math.sqrt(3) * voltage * power_factor);
      let temperature = 45 + 18 * shift + ramp * 9 + rng.normal(0, 1.3);
      let vibration = 1.8 + 1.1 * shift + ramp * 2.2 + rng.normal(0, 0.12);
      if (isSpike) vibration *= 1.3;

      const running = shift > 0.5;
      let units = running ? m.units_per_hour * (freqMin / 60) * Math.max(0, 1 + rng.normal(0, 0.06)) : 0;

      newRows.push({
        ts: nextTs,
        machine_id: mid,
        machine: m.name,
        voltage_v: voltage,
        current_a: current,
        power_factor: power_factor,
        power_kw: kw,
        energy_kwh: kw * (freqMin / 60),
        temperature_c: temperature,
        vibration_mm_s: vibration,
        units_produced: Math.max(0, units),
        running: running,
      });
    }

    return [...history, ...newRows];
  }

  function detectAnomalies(data, sensitivity = 0.03) {
    const groups = {};
    for (const r of data) {
      if (!groups[r.machine_id]) groups[r.machine_id] = [];
      groups[r.machine_id].push(r);
    }

    const result = [];
    for (const mid in groups) {
      const rows = groups[mid];
      const n = rows.length;
      if (n < 20) {
        rows.forEach(r => {
          result.push({ ...r, anomaly: false, anomaly_score: 0.0 });
        });
        continue;
      }

      const features = ["power_kw", "temperature_c", "vibration_mm_s", "power_factor"];
      const stats = {};
      for (const f of features) {
        const vals = rows.map(r => r[f]);
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
        const std = Math.sqrt(variance) || 1e-4;
        stats[f] = { mean, std };
      }

      const scored = rows.map(r => {
        let zSum = 0;
        for (const f of features) {
          const z = (r[f] - stats[f].mean) / stats[f].std;
          zSum += z * z;
        }
        return { row: r, score: Math.sqrt(zSum) };
      });

      scored.sort((a, b) => b.score - a.score);
      const cutoffIndex = Math.floor(n * sensitivity);
      const threshold = scored[cutoffIndex] ? scored[cutoffIndex].score : Infinity;

      scored.forEach(item => {
        const isAnomaly = item.score >= threshold;
        result.push({
          ...item.row,
          anomaly: isAnomaly,
          anomaly_score: Number(item.score.toFixed(3)),
        });
      });
    }

    result.sort((a, b) => a.ts - b.ts);
    return result;
  }

  function scaleScore(value, good, bad) {
    if (bad === good) return 1.0;
    return Math.min(1.0, Math.max(0.0, (bad - value) / (bad - good)));
  }

  function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function calculateHealthScores(df, windowHours = 6) {
    if (!df || df.length === 0) return [];
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const cutoffTime = new Date(maxTs.getTime() - windowHours * 3600 * 1000);

    const recent = df.filter(r => r.ts >= cutoffTime);
    const baseline = df.filter(r => r.ts < cutoffTime);

    const machineIds = [...new Set(df.map(r => r.machine_id))];
    const list = [];

    for (const mid of machineIds) {
      const g = recent.filter(r => r.machine_id === mid);
      const b = baseline.filter(r => r.machine_id === mid);
      if (g.length === 0) continue;

      const gRun = g.filter(r => r.running);
      const bRun = b.filter(r => r.running);

      let drift = 0.0;
      if (gRun.length > 0 && bRun.length > 0) {
        const baseKwMedian = median(bRun.map(r => r.power_kw));
        const gKwMedian = median(gRun.map(r => r.power_kw));
        drift = (gKwMedian - baseKwMedian) / Math.max(baseKwMedian, 0.1);
      }

      const temp = Math.max(...g.map(r => r.temperature_c));
      const vib = Math.max(...g.map(r => r.vibration_mm_s));
      const pf = g.reduce((acc, r) => acc + r.power_factor, 0) / g.length;
      const anomRate = g.filter(r => r.anomaly).length / g.length;

      const score = 100 * (
        0.28 * scaleScore(temp, CONFIG.TEMP_WARN_C, CONFIG.TEMP_CRIT_C) +
        0.28 * scaleScore(vib, CONFIG.VIB_WARN_MM_S, CONFIG.VIB_CRIT_MM_S) +
        0.20 * scaleScore(Math.abs(drift), 0.05, 0.45) +
        0.12 * scaleScore(0.95 - pf, 0.02, 0.20) +
        0.12 * scaleScore(anomRate, 0.02, 0.30)
      );

      const clampedScore = Math.min(100, Math.max(0, Number(score.toFixed(1))));
      let status = "Healthy";
      if (clampedScore < 50) status = "Critical";
      else if (clampedScore < 75) status = "Warning";

      const avgKw = g.reduce((a, r) => a + r.power_kw, 0) / g.length;

      list.push({
        machine_id: mid,
        machine: MACHINE_MAP[mid] ? MACHINE_MAP[mid].name : mid,
        health_score: clampedScore,
        status: status,
        avg_kw: Number(avgKw.toFixed(2)),
        max_temp_c: Number(temp.toFixed(1)),
        max_vibration: Number(vib.toFixed(2)),
        power_factor: Number(pf.toFixed(3)),
        energy_drift_pct: Number((drift * 100).toFixed(1)),
        anomaly_rate_pct: Number((anomRate * 100).toFixed(1)),
      });
    }

    list.sort((a, b) => a.health_score - b.health_score);
    return list;
  }

  function predictMaintenance(df, healthScores) {
    const healthMap = Object.fromEntries(healthScores.map(h => [h.machine_id, h]));
    const machineIds = [...new Set(df.map(r => r.machine_id))];
    const list = [];

    for (const mid of machineIds) {
      const g = df.filter(r => r.machine_id === mid).sort((a, b) => a.ts - b.ts);
      if (g.length < 20) continue;

      const minTime = g[0].ts.getTime();
      const xHours = g.map(r => (r.ts.getTime() - minTime) / 3600000);
      const preds = [];

      for (const [col, crit] of [["vibration_mm_s", CONFIG.VIB_CRIT_MM_S], ["temperature_c", CONFIG.TEMP_CRIT_C]]) {
        const y = g.map(r => r[col]);
        const n = y.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
          sumX += xHours[i];
          sumY += y[i];
          sumXY += xHours[i] * y[i];
          sumXX += xHours[i] * xHours[i];
        }
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1e-6);
        const recentVals = y.slice(-24);
        const current = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;

        if (slope > 1e-4 && current < crit) {
          preds.push(((crit - current) / slope) / 24);
        } else if (current >= crit) {
          preds.push(0.0);
        }
      }

      const days = preds.length > 0 ? Math.min(...preds) : Infinity;
      const score = healthMap[mid] ? healthMap[mid].health_score : 100;

      let risk = "Low";
      let action = "Continue routine monitoring";
      if (days <= 3 || score < 50) {
        risk = "High";
        action = "Schedule inspection within 48 hours";
      } else if (days <= 10 || score < 75) {
        risk = "Medium";
        action = "Plan maintenance in next service window";
      }

      list.push({
        machine_id: mid,
        machine: MACHINE_MAP[mid] ? MACHINE_MAP[mid].name : mid,
        days_to_threshold: Number.isFinite(days) ? Number(days.toFixed(1)) : null,
        failure_risk: risk,
        recommended_action: action,
      });
    }

    const order = { High: 0, Medium: 1, Low: 2 };
    list.sort((a, b) => order[a.failure_risk] - order[b.failure_risk]);
    return list;
  }

  function buildAlerts(df, healthScores, lookbackHours = 3) {
    if (!df || df.length === 0) return [];
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const cutoffTime = new Date(maxTs.getTime() - lookbackHours * 3600 * 1000);
    const recent = df.filter(r => r.ts >= cutoffTime);

    const alerts = [];
    const machineIds = [...new Set(df.map(r => r.machine_id))];

    for (const mid of machineIds) {
      const g = recent.filter(r => r.machine_id === mid);
      if (g.length === 0) continue;
      const name = MACHINE_MAP[mid] ? MACHINE_MAP[mid].name : mid;
      const last = g[g.length - 1];

      const baseData = df.filter(r => r.machine_id === mid);
      const baseMedianKw = median(baseData.map(r => r.power_kw));

      if (last.temperature_c >= CONFIG.TEMP_CRIT_C) {
        alerts.push({
          ts: last.ts,
          machine_id: mid,
          machine: name,
          type: "Overheating",
          severity: "Critical",
          message: `Temperature ${last.temperature_c.toFixed(1)} °C exceeds critical limit (${CONFIG.TEMP_CRIT_C} °C)`,
        });
      } else if (last.temperature_c >= CONFIG.TEMP_WARN_C) {
        alerts.push({
          ts: last.ts,
          machine_id: mid,
          machine: name,
          type: "Overheating",
          severity: "Warning",
          message: `Temperature ${last.temperature_c.toFixed(1)} °C trending high`,
        });
      }

      if (last.vibration_mm_s >= CONFIG.VIB_CRIT_MM_S) {
        alerts.push({
          ts: last.ts,
          machine_id: mid,
          machine: name,
          type: "Abnormal vibration",
          severity: "Critical",
          message: `Vibration ${last.vibration_mm_s.toFixed(2)} mm/s — ISO 10816 Zone D critical limit reached`,
        });
      } else if (last.vibration_mm_s >= CONFIG.VIB_WARN_MM_S) {
        alerts.push({
          ts: last.ts,
          machine_id: mid,
          machine: name,
          type: "Abnormal vibration",
          severity: "Warning",
          message: `Vibration ${last.vibration_mm_s.toFixed(2)} mm/s above normal threshold`,
        });
      }

      if (baseMedianKw > 0 && last.power_kw > baseMedianKw * 1.3 && last.running) {
        alerts.push({
          ts: last.ts,
          machine_id: mid,
          machine: name,
          type: "High energy consumption",
          severity: "Warning",
          message: `Drawing ${last.power_kw.toFixed(2)} kW vs baseline ${baseMedianKw.toFixed(2)} kW`,
        });
      }

      const lastSix = g.slice(-6);
      if (lastSix.some(r => r.anomaly)) {
        alerts.push({
          ts: last.ts,
          machine_id: mid,
          machine: name,
          type: "Possible machine fault",
          severity: "Warning",
          message: "AI detected abnormal multidimensional energy signature in recent readings",
        });
      }
    }

    for (const h of healthScores) {
      if (h.status === "Critical") {
        alerts.push({
          ts: maxTs,
          machine_id: h.machine_id,
          machine: h.machine,
          type: "Possible machine fault",
          severity: "Critical",
          message: `Health score ${h.health_score} / 100 — immediate maintenance intervention recommended`,
        });
      }
    }

    const unique = [];
    const seen = new Set();
    for (const a of alerts) {
      const key = `${a.machine_id}_${a.type}_${a.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(a);
      }
    }

    const sevOrder = { Critical: 0, Warning: 1 };
    unique.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
    return unique;
  }

  function calculateMonthlyBill(df, baseTariff = CONFIG.TARIFF_INR_PER_KWH, contractKva = CONFIG.CONTRACT_DEMAND_KVA) {
    if (!df || df.length === 0) {
      return {
        energy_charge_inr: 0, flat_energy_charge_inr: 0, demand_charge_inr: 0,
        max_demand_kva: 0, billed_demand_kva: contractKva * 0.75, avg_pf: 0.95,
        pf_adjustment_inr: 0, total_inr: 0, bands: [],
      };
    }

    const minTs = df.reduce((min, r) => (r.ts < min ? r.ts : min), df[0].ts);
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const spanDays = Math.max((maxTs.getTime() - minTs.getTime()) / 86400000, 0.5);
    const scale = 30 / spanDays;

    let energyCharge = 0;
    let flatCharge = 0;
    const bandTotals = {
      "Off-peak": { kwh: 0, cost: 0, rate: baseTariff * CONFIG.TOU_MULTIPLIER["Off-peak"] },
      "Normal": { kwh: 0, cost: 0, rate: baseTariff * CONFIG.TOU_MULTIPLIER["Normal"] },
      "Peak": { kwh: 0, cost: 0, rate: baseTariff * CONFIG.TOU_MULTIPLIER["Peak"] },
    };

    const plantMap = new Map();

    for (const r of df) {
      const band = bandOfHour(r.ts.getHours());
      const rate = baseTariff * CONFIG.TOU_MULTIPLIER[band];
      const cost = r.energy_kwh * rate;

      energyCharge += cost;
      flatCharge += r.energy_kwh * baseTariff;

      bandTotals[band].kwh += r.energy_kwh;
      bandTotals[band].cost += cost;

      const tKey = r.ts.getTime();
      if (!plantMap.has(tKey)) {
        plantMap.set(tKey, { kw: 0, kva: 0 });
      }
      const p = plantMap.get(tKey);
      p.kw += r.power_kw;
      p.kva += r.power_kw / Math.max(r.power_factor, 0.3);
    }

    energyCharge *= scale;
    flatCharge *= scale;

    const sortedTimes = [...plantMap.keys()].sort((a, b) => a - b);
    let maxDemandKva = 0;
    let totalPlantKw = 0;
    let totalPlantKva = 0;

    for (let i = 0; i < sortedTimes.length; i++) {
      const windowStart = Math.max(0, i - 2);
      let winKvaSum = 0;
      let count = 0;
      for (let j = windowStart; j <= i; j++) {
        winKvaSum += plantMap.get(sortedTimes[j]).kva;
        count++;
      }
      const rollingKva = winKvaSum / count;
      if (rollingKva > maxDemandKva) maxDemandKva = rollingKva;

      totalPlantKw += plantMap.get(sortedTimes[i]).kw;
      totalPlantKva += plantMap.get(sortedTimes[i]).kva;
    }

    const billedDemandKva = Math.max(maxDemandKva, 0.75 * contractKva);
    const demandCharge = billedDemandKva * CONFIG.DEMAND_CHARGE_INR_PER_KVA;

    const avgPf = totalPlantKw / Math.max(totalPlantKva, 1e-9);
    const gap = (CONFIG.PF_BENCHMARK - avgPf) * 100;
    let pfAdjustment = 0;
    if (gap > 0) {
      pfAdjustment = energyCharge * CONFIG.PF_PENALTY_PCT_PER_0_01 * (gap / 100);
    } else {
      pfAdjustment = -energyCharge * Math.min(CONFIG.PF_REBATE_PCT_PER_0_01 * -gap, CONFIG.PF_REBATE_CAP_PCT) / 100;
    }

    const totalBill = energyCharge + demandCharge + pfAdjustment;

    const bands = ["Off-peak", "Normal", "Peak"].map(b => ({
      band: b,
      kwh: Math.round(bandTotals[b].kwh * scale),
      cost_inr: Math.round(bandTotals[b].cost * scale),
      rate_inr: bandTotals[b].rate,
    }));

    return {
      energy_charge_inr: Math.round(energyCharge),
      flat_energy_charge_inr: Math.round(flatCharge),
      demand_charge_inr: Math.round(demandCharge),
      max_demand_kva: Number(maxDemandKva.toFixed(1)),
      billed_demand_kva: Number(billedDemandKva.toFixed(1)),
      avg_pf: Number(avgPf.toFixed(3)),
      pf_adjustment_inr: Math.round(pfAdjustment),
      total_inr: Math.round(totalBill),
      bands,
    };
  }

  function calculateHourlyLoadProfile(df) {
    const hourSums = Array(24).fill(0);
    const hourCounts = Array(24).fill(0);

    const timePlantKw = new Map();
    for (const r of df) {
      const t = r.ts.getTime();
      timePlantKw.set(t, (timePlantKw.get(t) || 0) + r.power_kw);
    }

    for (const [t, kw] of timePlantKw.entries()) {
      const h = new Date(t).getHours();
      hourSums[h] += kw;
      hourCounts[h]++;
    }

    return hourSums.map((sum, h) => (hourCounts[h] > 0 ? Number((sum / hourCounts[h]).toFixed(2)) : 0));
  }

  function calculateEfficiencyTable(df, tariff = CONFIG.TARIFF_INR_PER_KWH) {
    const machineIds = [...new Set(df.map(r => r.machine_id))];
    const list = [];

    for (const mid of machineIds) {
      const g = df.filter(r => r.machine_id === mid);
      const name = MACHINE_MAP[mid] ? MACHINE_MAP[mid].name : mid;
      const totalKwh = g.reduce((a, r) => a + r.energy_kwh, 0);
      const totalUnits = g.reduce((a, r) => a + r.units_produced, 0);
      const idleKwh = g.filter(r => !r.running).reduce((a, r) => a + r.energy_kwh, 0);

      const kwhPerUnit = totalUnits > 0 ? totalKwh / totalUnits : null;
      const idleSharePct = totalKwh > 0 ? (idleKwh / totalKwh) * 100 : 0;
      const costInr = totalKwh * tariff;
      const co2Kg = totalKwh * CONFIG.CO2_KG_PER_KWH;

      const hourMap = new Map();
      for (const r of g) {
        if (r.units_produced > 0) {
          const hKey = new Date(r.ts).setMinutes(0, 0, 0);
          if (!hourMap.has(hKey)) hourMap.set(hKey, { kwh: 0, units: 0 });
          const obj = hourMap.get(hKey);
          obj.kwh += r.energy_kwh;
          obj.units += r.units_produced;
        }
      }
      const hourlyRatios = [];
      for (const obj of hourMap.values()) {
        if (obj.units > 0) hourlyRatios.push(obj.kwh / obj.units);
      }
      hourlyRatios.sort((a, b) => a - b);
      const ownBest = hourlyRatios.length > 0 ? hourlyRatios[Math.floor(hourlyRatios.length * 0.1)] : kwhPerUnit;

      let effIndex = null;
      if (kwhPerUnit && ownBest) {
        effIndex = Math.min(100, Math.max(0, (ownBest / kwhPerUnit) * 100));
      }

      list.push({
        machine_id: mid,
        machine: name,
        energy_kwh: Number(totalKwh.toFixed(1)),
        units: Math.round(totalUnits),
        idle_kwh: Number(idleKwh.toFixed(1)),
        kwh_per_unit: kwhPerUnit ? Number(kwhPerUnit.toFixed(4)) : null,
        idle_share_pct: Number(idleSharePct.toFixed(1)),
        cost_inr: Math.round(costInr),
        co2_kg: Number(co2Kg.toFixed(1)),
        best_kwh_per_unit: ownBest ? Number(ownBest.toFixed(4)) : null,
        efficiency_index: effIndex ? Number(effIndex.toFixed(1)) : null,
      });
    }

    list.sort((a, b) => (a.efficiency_index || 0) - (b.efficiency_index || 0));
    return list;
  }

  function calculateSavingsEstimate(df, effTable, tariff = CONFIG.TARIFF_INR_PER_KWH) {
    const minTs = df.reduce((min, r) => (r.ts < min ? r.ts : min), df[0].ts);
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const spanDays = Math.max((maxTs.getTime() - minTs.getTime()) / 86400000, 0.5);
    const scale = 30 / spanDays;

    const totalIdleKwh = effTable.reduce((acc, r) => acc + r.idle_kwh, 0) * 0.6;

    let lagKwh = 0;
    for (const r of effTable) {
      if (r.kwh_per_unit && r.best_kwh_per_unit && r.units > 0) {
        const gap = Math.max(0, r.kwh_per_unit - r.best_kwh_per_unit);
        lagKwh += gap * r.units * 0.5;
      }
    }

    const pfKwh = df.filter(r => r.power_factor < 0.90).reduce((acc, r) => acc + r.energy_kwh, 0) * 0.04;
    const totalKwhMonth = (totalIdleKwh + lagKwh + pfKwh) * scale;

    return {
      idle_inr: Math.round(totalIdleKwh * scale * tariff),
      process_inr: Math.round(lagKwh * scale * tariff),
      power_factor_inr: Math.round(pfKwh * scale * tariff),
      total_inr: Math.round(totalKwhMonth * tariff),
      total_kwh: Math.round(totalKwhMonth),
      co2_kg: Math.round(totalKwhMonth * CONFIG.CO2_KG_PER_KWH),
    };
  }

  function calculateBeeBenchmarking(effTable) {
    return effTable.map(r => {
      const mid = r.machine_id;
      const kpu = r.kwh_per_unit;
      const norm = CONFIG.BEE_BENCHMARK_KWH_PER_UNIT[mid] || { "5_star": 0.05, "3_star": 0.08, name: r.machine };
      const fiveStar = norm["5_star"];
      const threeStar = norm["3_star"];

      let rating = "Utility / Support";
      let color = "#78716c";
      let gapPct = 0.0;

      if (!kpu || fiveStar === 0.0) {
        rating = "Utility / Support";
        color = "#78716c";
      } else if (kpu <= fiveStar) {
        rating = "5-Star (BEE Top Decile)";
        color = "#15803d";
        gapPct = Number(((kpu - fiveStar) / fiveStar * 100).toFixed(1));
      } else if (kpu <= threeStar) {
        rating = "3-Star (Industry Average)";
        color = "#b45309";
        gapPct = Number(((kpu - fiveStar) / fiveStar * 100).toFixed(1));
      } else {
        rating = "Sub-Standard (PAT Risk)";
        color = "#b91c1c";
        gapPct = Number(((kpu - fiveStar) / fiveStar * 100).toFixed(1));
      }

      return {
        machine_id: mid,
        machine: r.machine,
        kwh_per_unit: kpu ? Number(kpu.toFixed(4)) : null,
        bee_5_star_target: fiveStar > 0 ? fiveStar : null,
        rating,
        rating_color: color,
        gap_to_5_star_pct: gapPct,
      };
    });
  }

  function getRetrofitRoadmap(savings) {
    return [
      {
        tier: "Tier 1: Zero-Cost Operational",
        action: "Shift high-draw batch runs from Peak band (18:00–22:00) to Off-Peak (22:00–06:00)",
        equipment: "Injection Molder (M2) & Hydraulic Press (M3)",
        owner: "Shift Production Supervisor",
        capex_inr: 0,
        monthly_saving_inr: Math.round((savings.process_inr || 15000) * 0.7),
        payback: "Immediate (Day 1)",
        co2_avoided_kg: Math.round((savings.co2_kg || 2000) * 0.3),
      },
      {
        tier: "Tier 1: Zero-Cost Operational",
        action: "Implement strict 5-minute automated idling power cutoff on non-producing machines",
        equipment: "Conveyor Line (M5) & CNC Lathe (M1)",
        owner: "Shop Floor Operator",
        capex_inr: 0,
        monthly_saving_inr: Math.round(savings.idle_inr || 18000),
        payback: "Immediate (Day 1)",
        co2_avoided_kg: Math.round(((savings.idle_inr || 18000) / CONFIG.TARIFF_INR_PER_KWH) * CONFIG.CO2_KG_PER_KWH),
      },
      {
        tier: "Tier 2: Low-Cost Retrofit (<6 Mo Payback)",
        action: "Repair compressed air solenoid leaks and lower receiver pressure from 7.5 to 6.2 bar",
        equipment: "Air Compressor (M4)",
        owner: "Plant Maintenance Engineer",
        capex_inr: 12000,
        monthly_saving_inr: 14500,
        payback: "0.8 Months (< 25 days)",
        co2_avoided_kg: 1210,
      },
      {
        tier: "Tier 2: Low-Cost Retrofit (<6 Mo Payback)",
        action: "Install 25 kVAR Automatic Power Factor Correction (APFC) capacitor bank to reach 0.98 PF",
        equipment: "Main LT Panel / Transformer",
        owner: "Plant Electrical Engineer",
        capex_inr: 45000,
        monthly_saving_inr: Math.round(savings.power_factor_inr || 12000),
        payback: "3.8 Months",
        co2_avoided_kg: 850,
      },
      {
        tier: "Tier 3: Strategic Capex & Decarb",
        action: "Replace ageing IE1 motor on Hydraulic Press with IE4 Super-Premium motor with VFD",
        equipment: "Hydraulic Press (M3)",
        owner: "Works Manager / Plant Head",
        capex_inr: 85000,
        monthly_saving_inr: 8200,
        payback: "10.4 Months",
        co2_avoided_kg: 680,
      },
      {
        tier: "Tier 3: Strategic Capex & Decarb",
        action: "Install 25 kWp Grid-Tied Rooftop Solar to offset daytime peak grid import",
        equipment: "Factory Shed Rooftop",
        owner: "Managing Director / Promoter",
        capex_inr: 1100000,
        monthly_saving_inr: 28500,
        payback: "38 Months (~3.2 Years)",
        co2_avoided_kg: 2850,
      },
    ];
  }

  function getRecommendations(df, healthScores, effTable, maintForecast, savings) {
    const actions = [];
    const sortedIdle = [...effTable].sort((a, b) => b.idle_share_pct - a.idle_share_pct);
    for (const r of sortedIdle.slice(0, 2)) {
      if (r.idle_share_pct > 8) {
        const savingAmt = r.idle_kwh * 0.6 * CONFIG.TARIFF_INR_PER_KWH;
        actions.push({
          machine: `${r.machine} (${r.machine_id})`,
          action: `Program 5-minute standby auto-cutoff timer during lunch and operator shift changes. Currently ${r.idle_share_pct}% of energy is consumed while idle.`,
          owner: "Line Operator / Maintenance Tech",
          effort: "Low (15 mins PLC timer adjustment)",
          impact: `Save ≈ ₹${Math.round(savingAmt).toLocaleString("en-IN")} / window (₹${Math.round(savingAmt * 10).toLocaleString("en-IN")}/mo)`,
          category: "Operational Waste",
        });
      }
    }

    const highRisk = maintForecast.filter(m => m.failure_risk === "High");
    for (const r of highRisk) {
      actions.push({
        machine: `${r.machine} (${r.machine_id})`,
        action: "Inspect motor bearing lubrication, check shaft alignment, and measure phase winding resistance.",
        owner: "Maintenance Engineer",
        effort: "Medium (2 hours during planned shift changeover)",
        impact: `${r.days_to_threshold !== null ? `Critical limit breach projected in ~${r.days_to_threshold} days.` : "Critical vibration threshold breached."} Prevents unplanned breakdown costing ₹1.5L+ in downtime.`,
        category: "Predictive Maintenance",
      });
    }

    actions.push({
      machine: "Air Compressor (M4)",
      action: "Conduct ultrasonic pneumatic air leak audit on main delivery header and replace leaking quick-disconnect couplings.",
      owner: "Pneumatics Maintenance Tech",
      effort: "Low (45 mins audit on Sunday/idle period)",
      impact: "Reduces compressor cycle frequency by 18%; saves ≈ ₹14,500/month in power",
      category: "Utility Optimization",
    });

    const lowPfMachines = healthScores.filter(h => h.power_factor < 0.92);
    for (const h of lowPfMachines) {
      actions.push({
        machine: `${h.machine} (${h.machine_id})`,
        action: `Add localized 5 kVAR power factor correction capacitor at motor terminals. Average PF is currently ${h.power_factor} vs 0.95 utility benchmark.`,
        owner: "Plant Electrician",
        effort: "Low (1 hour installation)",
        impact: `Eliminates utility surcharge; monthly saving ≈ ₹${savings.power_factor_inr.toLocaleString("en-IN")}`,
        category: "Power Quality",
      });
    }

    return actions;
  }

  function applyLevers(df, { idleCut = 0, efficiencyGain = 0, shiftShare = {}, pfTarget = null, solarKwp = 0 }) {
    const dtHours = 5 / 60;
    const copy = df.map(r => ({ ...r }));
    const shifted = {};

    if (idleCut > 0) {
      copy.forEach(r => {
        if (!r.running) {
          r.power_kw *= (1 - idleCut);
          r.energy_kwh *= (1 - idleCut);
        }
      });
    }

    if (efficiencyGain > 0) {
      copy.forEach(r => {
        if (r.running) {
          r.power_kw *= (1 - efficiencyGain);
          r.energy_kwh *= (1 - efficiencyGain);
        }
      });
    }

    if (shiftShare && Object.keys(shiftShare).length > 0) {
      for (const [mid, share] of Object.entries(shiftShare)) {
        if (share <= 0) continue;
        const mRows = copy.filter(r => r.machine_id === mid);
        const peakRows = mRows.filter(r => bandOfHour(r.ts.getHours()) === "Peak");
        const offRows = mRows.filter(r => bandOfHour(r.ts.getHours()) === "Off-peak");

        const peakKwh = peakRows.reduce((a, r) => a + r.energy_kwh, 0);
        if (peakKwh <= 0 || offRows.length === 0) continue;

        const ratedKw = MACHINE_MAP[mid] ? MACHINE_MAP[mid].base_kw * 1.5 : 10;
        const headroomList = offRows.map(r => Math.max(0, ratedKw - r.power_kw));
        const roomKwh = headroomList.reduce((a, b) => a + b, 0) * dtHours;

        const moved = Math.min(peakKwh * share, roomKwh);
        if (moved <= 0) continue;

        peakRows.forEach(r => {
          const factor = 1 - moved / peakKwh;
          r.power_kw *= factor;
          r.energy_kwh *= factor;
        });

        const totalHeadroom = headroomList.reduce((a, b) => a + b, 0);
        offRows.forEach((r, idx) => {
          const addKwh = totalHeadroom > 0 ? (moved * headroomList[idx]) / totalHeadroom : moved / offRows.length;
          r.energy_kwh += addKwh;
          r.power_kw += addKwh / dtHours;
        });

        shifted[mid] = moved;
      }
    }

    if (pfTarget) {
      copy.forEach(r => {
        r.power_factor = Math.max(r.power_factor, pfTarget);
      });
    }

    if (solarKwp > 0) {
      const timePlantKw = new Map();
      copy.forEach(r => {
        const t = r.ts.getTime();
        timePlantKw.set(t, (timePlantKw.get(t) || 0) + r.power_kw);
      });

      copy.forEach(r => {
        const hour = r.ts.getHours() + r.ts.getMinutes() / 60;
        const solarGen = solarKwp * CONFIG.SOLAR_PEAK_FACTOR * Math.max(0, Math.sin(Math.PI * (hour - 6) / 12));
        const plantKw = Math.max(timePlantKw.get(r.ts.getTime()) || 1e-9, 1e-9);
        const frac = Math.min(solarGen, plantKw) / plantKw;
        r.power_kw *= (1 - frac);
        r.energy_kwh *= (1 - frac);
      });
    }

    return { modifiedDf: copy, shiftedKwh: shifted };
  }

  function evaluateScenario(df, tariff, levers = {}, greenShare = 0) {
    const { modifiedDf, shiftedKwh } = applyLevers(df, levers);
    const bill = calculateMonthlyBill(modifiedDf, tariff);

    const minTs = df.reduce((min, r) => (r.ts < min ? r.ts : min), df[0].ts);
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const spanDays = Math.max((maxTs.getTime() - minTs.getTime()) / 86400000, 0.5);
    const scale = 30 / spanDays;

    const kwhMonth = modifiedDf.reduce((a, r) => a + r.energy_kwh, 0) * scale;
    const co2KgMonth = kwhMonth * CONFIG.CO2_KG_PER_KWH * (1 - greenShare);

    return {
      after: modifiedDf,
      shiftedKwh,
      bill,
      total_inr: bill.total_inr,
      kwh_month: Math.round(kwhMonth),
      co2_kg_month: Math.round(co2KgMonth),
    };
  }

  // Application State
  const state = {
    hours: 72,
    tariff: CONFIG.TARIFF_INR_PER_KWH,
    sensitivity: 0.03,
    selectedMachines: MACHINES.map(m => m.id),
    user: {
      name: "Subham Pattnaik",
      role: "Plant Manager",
      plant: "Pune SME Unit 2",
    },
    activeTab: "tab-today",
    rawTelemetry: [],
    scoredTelemetry: [],
    filteredTelemetry: [],
    diagMid: "M1",
    outlierMid: "M1",
    floorMetric: "status",
    selectedFloorMachine: "M1",
    autopilot: {
      idleCut: 0.60,
      pfTarget: 0.97,
      flex: { ...CONFIG.FLEX_DEFAULT },
      log: [],
    },
    carbon: {
      idle: 0.40,
      eff: 0.05,
      shift: 0.50,
      solarKwp: 20,
      greenShare: 0.10,
      rolloutMonths: 6,
      targetPct: 0.25,
      fuelOn: false,
      fuelType: "Diesel",
      fuelKwh: 10000,
      fuelShare: 0.50,
      fuelTarget: "Electric heat pump",
      boilerEff: 0.80,
      cop: 3.0,
      bioEff: 0.75,
      bioPrice: 2.0,
    },
    incidents: {},
  };

  const charts = {};

  function destroyChart(id) {
    if (charts[id]) {
      try { charts[id].destroy(); } catch(e) {}
      delete charts[id];
    }
  }

  const fmtInr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const fmtNum = (n, dec = 1) => Number(n).toFixed(dec);

  function processData() {
    state.scoredTelemetry = detectAnomalies(state.rawTelemetry, state.sensitivity);
    state.filteredTelemetry = state.scoredTelemetry.filter(r => state.selectedMachines.includes(r.machine_id));
  }

  function renderAll() {
    const df = state.filteredTelemetry;
    if (!df || df.length === 0) return;

    const healthScores = calculateHealthScores(df);
    const maintForecast = predictMaintenance(df, healthScores);
    const alerts = buildAlerts(df, healthScores);
    const effTable = calculateEfficiencyTable(df, state.tariff);
    const savings = calculateSavingsEstimate(df, effTable, state.tariff);
    const bill = calculateMonthlyBill(df, state.tariff);
    const beeTable = calculateBeeBenchmarking(effTable);
    const roadmap = getRetrofitRoadmap(savings);
    const recs = getRecommendations(df, healthScores, effTable, maintForecast, savings);

    renderTopKpis(df, savings);
    renderTodayTab(df, healthScores, alerts);
    renderMachinesTab(df, healthScores, maintForecast);
    renderEnergyBillTab(df, bill, savings);
    renderScheduleTab(df, effTable);
    renderCarbonTab(df);
    renderSavingsPlanTab(df, beeTable, roadmap, recs, savings);
    renderDataSetupTab(df, healthScores, effTable, savings, bill, recs);
  }

  function renderTopKpis(df, savings) {
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const liveRows = df.filter(r => r.ts.getTime() === maxTs.getTime());
    const liveKw = liveRows.reduce((acc, r) => acc + r.power_kw, 0);

    const totalKwh = df.reduce((acc, r) => acc + r.energy_kwh, 0);
    const totalCost = totalKwh * state.tariff;
    const tco2e = (totalKwh * CONFIG.CO2_KG_PER_KWH) / 1000;
    const totalUnits = df.reduce((acc, r) => acc + r.units_produced, 0);
    const prodTonnes = Math.max(totalUnits * CONFIG.PRODUCT_TONNES_PER_UNIT, 0.01);
    const emissionsIntensity = tco2e / prodTonnes;

    const elLive = document.getElementById("kpi-live-load");
    if (elLive) elLive.textContent = `${fmtNum(liveKw, 1)} kW`;
    const elWin = document.getElementById("kpi-energy-window");
    if (elWin) elWin.textContent = `${Math.round(totalKwh).toLocaleString("en-IN")} kWh`;
    const elCost = document.getElementById("kpi-energy-cost");
    if (elCost) elCost.textContent = fmtInr(totalCost);
    const elCarb = document.getElementById("kpi-carbon");
    if (elCarb) elCarb.textContent = `${fmtNum(tco2e, 2)} tCO₂e`;
    const elCarbDelta = document.getElementById("kpi-carbon-delta");
    if (elCarbDelta) elCarbDelta.textContent = `${fmtNum(emissionsIntensity, 3)} t/tonne prod`;
    const elSav = document.getElementById("kpi-possible-savings");
    if (elSav) elSav.textContent = `${fmtInr(savings.total_inr)}/mo`;

    const dateStr = maxTs.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const elMeta = document.getElementById("header-meta-info");
    if (elMeta) elMeta.textContent = `Last reading: ${dateStr} • ${state.selectedMachines.length} machines active • Plant: ${state.user.plant}`;
  }

  function renderTodayTab(df, healthScores, alerts) {
    const healthGrid = document.getElementById("today-health-grid");
    if (healthGrid) {
      healthGrid.innerHTML = healthScores.map(h => {
        const dot = h.status === "Healthy" ? "🟢" : (h.status === "Warning" ? "🟡" : "🔴");
        const pillClass = `pill-${h.status.toLowerCase()}`;
        return `
          <div class="health-card">
            <div class="health-card-header">
              <div class="health-machine-name">${dot} ${h.machine}</div>
              <span class="pill ${pillClass}">${h.status}</span>
            </div>
            <div class="health-score-val">${h.health_score}<span>/100</span></div>
            <div class="health-metrics-list">
              <b>${h.machine_id}</b> · ${h.avg_kw} kW avg<br/>
              🌡 ${h.max_temp_c} °C · 📳 ${h.max_vibration} mm/s<br/>
              Energy drift ${h.energy_drift_pct}% · Outliers ${h.anomaly_rate_pct}%
            </div>
          </div>
        `;
      }).join("");
    }

    const avgHealth = healthScores.reduce((acc, h) => acc + h.health_score, 0) / (healthScores.length || 1);
    const elAvgLab = document.getElementById("plant-health-avg-label");
    if (elAvgLab) elAvgLab.textContent = `Plant equipment health average: ${fmtNum(avgHealth, 1)} / 100`;
    const elAvgBar = document.getElementById("plant-health-avg-bar");
    if (elAvgBar) elAvgBar.style.width = `${avgHealth}%`;

    renderPlantLoadChart(df);
    renderEnergyShareChart(df);
    renderIncidentsConsole(alerts);
  }

  function renderPlantLoadChart(df) {
    if (!window.Chart) return;
    destroyChart("chart-plant-load");
    const timeMap = new Map();
    for (const r of df) {
      const t = r.ts.getTime();
      timeMap.set(t, (timeMap.get(t) || 0) + r.power_kw);
    }

    const sortedTimes = [...timeMap.keys()].sort((a, b) => a - b);
    const step = Math.max(1, Math.floor(sortedTimes.length / 50));
    const sampledTimes = sortedTimes.filter((_, idx) => idx % step === 0);

    const labels = sampledTimes.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const data = sampledTimes.map(t => Number(timeMap.get(t).toFixed(1)));

    const canvas = document.getElementById("chart-plant-load");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-plant-load"] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Plant Power (kW)',
          data,
          borderColor: '#C85A32',
          backgroundColor: 'rgba(200, 90, 50, 0.22)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2.5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#78716C', font: { size: 11 } } },
          y: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C', font: { size: 11 } } },
        }
      }
    });
  }

  function renderEnergyShareChart(df) {
    if (!window.Chart) return;
    destroyChart("chart-energy-share");
    const shareMap = {};
    for (const r of df) {
      shareMap[r.machine] = (shareMap[r.machine] || 0) + r.energy_kwh;
    }

    const labels = Object.keys(shareMap);
    const data = labels.map(k => Math.round(shareMap[k]));
    const palette = ['#C85A32', '#D96B43', '#E27B55', '#B84B24', '#8C3B1E', '#E89C82'];

    const canvas = document.getElementById("chart-energy-share");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-energy-share"] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: palette.slice(0, labels.length),
          borderWidth: 2,
          borderColor: '#FFF',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, color: '#1C1917', font: { size: 11 } } }
        }
      }
    });
  }

  function renderIncidentsConsole(alerts) {
    for (const a of alerts) {
      const key = `${a.machine_id}_${a.type}`;
      if (!state.incidents[key]) {
        state.incidents[key] = { ...a, id: key, status: "Open" };
      } else {
        state.incidents[key].message = a.message;
      }
    }

    const incList = Object.values(state.incidents);
    const critCount = incList.filter(i => i.severity === "Critical" && i.status !== "Resolved").length;
    const openCount = incList.filter(i => i.status === "Open").length;
    const resolvedCount = incList.filter(i => i.status === "Resolved").length;

    const elCrit = document.getElementById("incident-crit-count");
    if (elCrit) elCrit.textContent = critCount;
    const elOpen = document.getElementById("incident-open-count");
    if (elOpen) elOpen.textContent = openCount;
    const elRes = document.getElementById("incident-resolved-count");
    if (elRes) elRes.textContent = resolvedCount;

    const container = document.getElementById("today-incidents-list");
    if (!container) return;
    const activeIncidents = incList.filter(i => i.status !== "Resolved");

    if (activeIncidents.length === 0) {
      container.innerHTML = `<div style="padding:16px;text-align:center;color:#15803D;font-weight:700;">✅ No active unresolved incidents on the shop floor.</div>`;
      return;
    }

    container.innerHTML = activeIncidents.map(inc => `
      <div class="incident-card ${inc.severity.toLowerCase()}">
        <div>
          <b style="color:#1C1917;">${inc.type} — ${inc.machine} (${inc.machine_id})</b>
          <div style="font-size:12px;color:#78716C;margin-top:2px;">${inc.message}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pill pill-${inc.severity.toLowerCase()}">${inc.severity}</span>
          <button class="btn btn-secondary btn-sm" onclick="window.resolveIncident('${inc.id}')" style="padding:4px 8px;font-size:11px;">Resolve</button>
        </div>
      </div>
    `).join("");
  }

  window.resolveIncident = function(id) {
    if (state.incidents[id]) {
      state.incidents[id].status = "Resolved";
      renderAll();
    }
  };

  function renderMachinesTab(df, healthScores, maintForecast) {
    renderShopFloor(df, healthScores);
    renderMachineDiagnostics(df, healthScores);
    renderMaintenanceForecastTable(maintForecast);
    renderOutlierSpikeChart(df);
  }

  function renderShopFloor(df, healthScores) {
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const liveRows = df.filter(r => r.ts.getTime() === maxTs.getTime());
    const liveMap = Object.fromEntries(liveRows.map(r => [r.machine_id, r]));
    const healthMap = Object.fromEntries(healthScores.map(h => [h.machine_id, h]));

    const bay1 = ["M1", "M2", "M3"];
    const bay2 = ["M4", "M5", "M6"];

    const renderNodes = mids => mids.map(mid => {
      const m = MACHINE_MAP[mid];
      const live = liveMap[mid] || {};
      const h = healthMap[mid] || { health_score: 100, status: "Healthy" };

      let metricVal = "";
      let badgeColor = "#15803D";

      if (state.floorMetric === "status") {
        badgeColor = h.status === "Healthy" ? "#15803D" : (h.status === "Warning" ? "#B45309" : "#B91C1C");
        metricVal = `Health: ${h.health_score}/100`;
      } else if (state.floorMetric === "power") {
        metricVal = `Load: ${fmtNum(live.power_kw || 0)} kW`;
        badgeColor = (live.power_kw || 0) > 8 ? "#B91C1C" : "#C85A32";
      } else if (state.floorMetric === "temp") {
        metricVal = `Temp: ${fmtNum(live.temperature_c || 0)} °C`;
        badgeColor = (live.temperature_c || 0) > 75 ? "#B91C1C" : "#D96B43";
      } else if (state.floorMetric === "vibration") {
        metricVal = `Vib: ${fmtNum(live.vibration_mm_s || 0, 2)} mm/s`;
        badgeColor = (live.vibration_mm_s || 0) > 5.0 ? "#B91C1C" : "#15803D";
      }

      const isSelected = state.selectedFloorMachine === mid ? "selected" : "";

      return `
        <div class="workstation-node ${isSelected}" onclick="window.selectFloorMachine('${mid}')">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b style="font-size:14px;">${m.icon} ${mid} · ${m.name}</b>
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${badgeColor};box-shadow:0 0 8px ${badgeColor};"></span>
          </div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;margin-top:6px;color:#FFF;">
            ${metricVal}
          </div>
          <div style="font-size:11px;color:#A8A29E;margin-top:4px;">
            ${fmtNum(live.power_kw || 0)} kW · ${fmtNum(live.temperature_c || 0)} °C · PF ${fmtNum(live.power_factor || 0.95, 3)}
          </div>
        </div>
      `;
    }).join("");

    const b1 = document.getElementById("floor-bay-1-nodes");
    if (b1) b1.innerHTML = renderNodes(bay1);
    const b2 = document.getElementById("floor-bay-2-nodes");
    if (b2) b2.innerHTML = renderNodes(bay2);
  }

  window.selectFloorMachine = function(mid) {
    state.selectedFloorMachine = mid;
    state.diagMid = mid;
    const sel = document.getElementById("select-diag-mid");
    if (sel) sel.value = mid;
    renderAll();
  };

  function renderMachineDiagnostics(df, healthScores) {
    const mid = state.diagMid;
    const m = MACHINE_MAP[mid];
    const mRows = df.filter(r => r.machine_id === mid);
    const lastRow = mRows[mRows.length - 1] || {};
    const health = healthScores.find(h => h.machine_id === mid) || { health_score: 100, status: "Healthy" };

    const elTitle = document.getElementById("diag-machine-title");
    if (elTitle) elTitle.textContent = `${m.icon} ${mid} — ${m.name} Diagnostics`;
    const elBadge = document.getElementById("diag-health-badge");
    if (elBadge) {
      elBadge.textContent = `${health.status} (${health.health_score} / 100)`;
      elBadge.className = `pill pill-${health.status.toLowerCase()}`;
    }

    renderGauge("chart-gauge-pf", lastRow.power_factor || 0.95, 0.6, 1.0, "PF (Cos φ)", val => val.toFixed(3));
    renderGauge("chart-gauge-temp", lastRow.temperature_c || 50, 30, 95, "Temp (°C)", val => `${val.toFixed(1)} °C`, 72, 85);
    const loadRatio = ((lastRow.power_kw || 0) / (m.base_kw * 1.5)) * 100;
    renderGauge("chart-gauge-load", loadRatio, 0, 150, "Load Ratio (%)", val => `${Math.round(val)}%`, 90, 115);

    renderDiagnosticRadar(lastRow, m);
  }

  function renderGauge(canvasId, value, min, max, label, formatFn, warnVal = null, critVal = null) {
    if (!window.Chart) return;
    destroyChart(canvasId);
    const normalized = Math.min(max, Math.max(min, value));
    const pct = (normalized - min) / (max - min);

    let barColor = "#C85A32";
    if (critVal !== null && value >= critVal) barColor = "#B91C1C";
    else if (warnVal !== null && value >= warnVal) barColor = "#B45309";
    else barColor = "#15803D";

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [pct, 1 - pct],
          backgroundColor: [barColor, '#E8D4CC'],
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        circumference: 180,
        rotation: 270,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        }
      }
    });

    const valEl = document.getElementById(`${canvasId}-val`);
    if (valEl) valEl.textContent = formatFn(value);
  }

  function renderDiagnosticRadar(lastRow, m) {
    if (!window.Chart) return;
    destroyChart("chart-diag-radar");
    const canvas = document.getElementById("chart-diag-radar");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const powerScore = Math.min(100, ((lastRow.power_kw || 0) / (m.base_kw * 1.4)) * 100);
    const tempScore = Math.min(100, Math.max(0, ((lastRow.temperature_c - 40) / 45) * 100));
    const vibScore = Math.min(100, Math.max(0, ((lastRow.vibration_mm_s - 1.5) / 5.6) * 100));
    const pfScore = Math.min(100, Math.max(0, (1 - (lastRow.power_factor - 0.6) / 0.4) * 100));
    const driftScore = Math.min(100, Math.abs(lastRow.power_kw - m.base_kw) * 20);

    charts["chart-diag-radar"] = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Power Draw', 'Thermal Stress', 'Vibration (ISO)', 'Reactive Penalty (PF)', 'Process Drift'],
        datasets: [{
          label: `${m.name} Diagnostic Stress`,
          data: [powerScore, tempScore, vibScore, pfScore, driftScore],
          backgroundColor: 'rgba(200, 90, 50, 0.25)',
          borderColor: '#C85A32',
          pointBackgroundColor: '#C85A32',
          pointBorderColor: '#FFF',
          pointHoverBackgroundColor: '#FFF',
          pointHoverBorderColor: '#C85A32',
          borderWidth: 2,
        }, {
          label: 'Safe Baseline Boundary',
          data: [60, 60, 60, 60, 60],
          borderColor: 'rgba(21, 128, 61, 0.6)',
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { display: false, stepSize: 20 },
            grid: { color: 'rgba(167, 65, 30, 0.15)' },
            pointLabels: { color: '#1C1917', font: { size: 11, weight: '700' } }
          }
        },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, color: '#1C1917' } } }
      }
    });
  }

  function renderMaintenanceForecastTable(maintForecast) {
    const tbody = document.getElementById("table-maint-forecast-body");
    if (!tbody) return;
    tbody.innerHTML = maintForecast.map(m => {
      const pillClass = `pill-${m.failure_risk.toLowerCase()}`;
      const etaStr = m.days_to_threshold !== null ? `~${m.days_to_threshold} days` : "Threshold reached";
      return `
        <tr>
          <td><b>${m.machine_id}</b></td>
          <td>${m.machine}</td>
          <td><b>${etaStr}</b></td>
          <td><span class="pill ${pillClass}">${m.failure_risk}</span></td>
          <td>${m.recommended_action}</td>
        </tr>
      `;
    }).join("");
  }

  function renderOutlierSpikeChart(df) {
    if (!window.Chart) return;
    destroyChart("chart-outlier-spikes");
    const mid = state.outlierMid;
    const mRows = df.filter(r => r.machine_id === mid);
    const step = Math.max(1, Math.floor(mRows.length / 70));
    const sampled = mRows.filter((_, idx) => idx % step === 0);

    const labels = sampled.map(r => r.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const powerData = sampled.map(r => Number(r.power_kw.toFixed(2)));
    const anomalyPoints = sampled.map(r => (r.anomaly ? Number(r.power_kw.toFixed(2)) : null));

    const canvas = document.getElementById("chart-outlier-spikes");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-outlier-spikes"] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Power Draw (kW)',
          data: powerData,
          borderColor: '#C85A32',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
        }, {
          label: 'Unusual Outlier Spike',
          data: anomalyPoints,
          borderColor: '#B91C1C',
          backgroundColor: '#B91C1C',
          pointRadius: 5,
          pointStyle: 'crossRot',
          showLine: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, color: '#1C1917' } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#78716C', font: { size: 10 } } },
          y: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C', font: { size: 10 } } }
        }
      }
    });
  }

  function renderEnergyBillTab(df, bill, savings) {
    const elTot = document.getElementById("bill-projected-total");
    if (elTot) elTot.textContent = fmtInr(bill.total_inr);
    const elEng = document.getElementById("bill-energy-charge");
    if (elEng) elEng.textContent = fmtInr(bill.energy_charge_inr);
    const flatDiff = bill.energy_charge_inr - bill.flat_energy_charge_inr;
    const elDel = document.getElementById("bill-energy-delta");
    if (elDel) elDel.textContent = `${flatDiff >= 0 ? '+' : ''}${fmtInr(flatDiff)} vs flat rate`;
    const elMax = document.getElementById("bill-max-demand");
    if (elMax) elMax.textContent = `${bill.max_demand_kva} kVA`;
    const elDem = document.getElementById("bill-demand-charge");
    if (elDem) elDem.textContent = `Demand charge ${fmtInr(bill.demand_charge_inr)}`;
    const elPfTit = document.getElementById("bill-pf-title");
    if (elPfTit) elPfTit.textContent = bill.pf_adjustment_inr > 0 ? "PF Penalty" : "PF Rebate";
    const elPfVal = document.getElementById("bill-pf-val");
    if (elPfVal) elPfVal.textContent = fmtInr(Math.abs(bill.pf_adjustment_inr));
    const elPfDel = document.getElementById("bill-pf-delta");
    if (elPfDel) elPfDel.textContent = `avg PF ${bill.avg_pf}`;

    renderHourlyBandChart(df);
    renderMonthlyBandChart(bill.bands);
    renderDailyCostChart(df);
    renderSavingsSourceChart(savings);
  }

  function renderHourlyBandChart(df) {
    if (!window.Chart) return;
    destroyChart("chart-hourly-band");
    const hourlyKw = calculateHourlyLoadProfile(df);
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const colors = hours.map(h => CONFIG.TOU_COLOR[bandOfHour(h)]);

    const canvas = document.getElementById("chart-hourly-band");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-hourly-band"] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: hours.map(h => `${h}:00`),
        datasets: [{
          label: 'Average Plant Load (kW)',
          data: hourlyKw,
          backgroundColor: colors,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context => `${context.raw} kW (${bandOfHour(context.dataIndex)})`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#78716C', font: { size: 10 } } },
          y: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C', font: { size: 10 } } }
        }
      }
    });
  }

  function renderMonthlyBandChart(bands) {
    if (!window.Chart) return;
    destroyChart("chart-monthly-cost-band");
    const canvas = document.getElementById("chart-monthly-cost-band");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-monthly-cost-band"] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: bands.map(b => b.band),
        datasets: [{
          label: 'Cost (₹ / month)',
          data: bands.map(b => b.cost_inr),
          backgroundColor: bands.map(b => CONFIG.TOU_COLOR[b.band]),
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#1C1917', font: { weight: '700' } } },
          y: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C' } }
        }
      }
    });
  }

  function renderDailyCostChart(df) {
    if (!window.Chart) return;
    destroyChart("chart-daily-cost");
    const dateMachineMap = new Map();
    const dateSet = new Set();
    for (const r of df) {
      const dStr = r.ts.toISOString().split("T")[0];
      dateSet.add(dStr);
      const key = `${dStr}_${r.machine}`;
      dateMachineMap.set(key, (dateMachineMap.get(key) || 0) + r.energy_kwh * state.tariff);
    }

    const sortedDates = [...dateSet].sort();
    const machineNames = MACHINES.map(m => m.name);
    const palette = ['#C85A32', '#D96B43', '#E27B55', '#B84B24', '#8C3B1E', '#E89C82'];

    const datasets = machineNames.map((name, idx) => ({
      label: name,
      data: sortedDates.map(d => Math.round(dateMachineMap.get(`${d}_${name}`) || 0)),
      backgroundColor: palette[idx % palette.length],
      borderRadius: 3,
    }));

    const canvas = document.getElementById("chart-daily-cost");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-daily-cost"] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sortedDates.map(d => d.slice(5)),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#78716C' } },
          y: { stacked: true, grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C' } }
        },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
      }
    });
  }

  function renderSavingsSourceChart(savings) {
    if (!window.Chart) return;
    destroyChart("chart-savings-breakdown");
    const canvas = document.getElementById("chart-savings-breakdown");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-savings-breakdown"] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Idle / standby waste', 'Process deviation', 'Power-factor penalty'],
        datasets: [{
          label: 'Monthly Saving Potential (₹)',
          data: [savings.idle_inr, savings.process_inr, savings.power_factor_inr],
          backgroundColor: '#15803D',
          borderRadius: 6,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C' } },
          y: { grid: { display: false }, ticks: { color: '#1C1917', font: { weight: '600' } } }
        }
      }
    });
  }

  function renderScheduleTab(df, effTable) {
    const s1Rows = df.filter(r => r.ts.getHours() >= 6 && r.ts.getHours() < 14);
    const s2Rows = df.filter(r => r.ts.getHours() >= 14 && r.ts.getHours() < 22);
    const nightRows = df.filter(r => r.ts.getHours() >= 22 || r.ts.getHours() < 6);

    const s1Kwh = s1Rows.reduce((a, r) => a + r.energy_kwh, 0);
    const s2Kwh = s2Rows.reduce((a, r) => a + r.energy_kwh, 0);
    const nightKwh = nightRows.reduce((a, r) => a + r.energy_kwh, 0);

    const elS1 = document.getElementById("shift-1-kwh");
    if (elS1) elS1.textContent = `${Math.round(s1Kwh).toLocaleString("en-IN")} kWh`;
    const elS1C = document.getElementById("shift-1-cost");
    if (elS1C) elS1C.textContent = fmtInr(s1Kwh * state.tariff);
    const elS2 = document.getElementById("shift-2-kwh");
    if (elS2) elS2.textContent = `${Math.round(s2Kwh).toLocaleString("en-IN")} kWh`;
    const elS2C = document.getElementById("shift-2-cost");
    if (elS2C) elS2C.textContent = fmtInr(s2Kwh * state.tariff);
    const elSN = document.getElementById("shift-night-kwh");
    if (elSN) elSN.textContent = `${Math.round(nightKwh).toLocaleString("en-IN")} kWh`;
    const elSNC = document.getElementById("shift-night-cost");
    if (elSNC) elSNC.textContent = `${fmtInr(nightKwh * state.tariff * 0.85)} (Off-Peak Rate)`;

    const peakRows = df.filter(r => r.ts.getHours() >= 18 && r.ts.getHours() < 22);
    const peakKwh = peakRows.reduce((a, r) => a + r.energy_kwh, 0);
    const totalKwh = df.reduce((a, r) => a + r.energy_kwh, 0) || 1;
    const peakShare = (peakKwh / totalKwh) * 100;
    const peakCost = peakKwh * state.tariff * 1.20;

    const elPeak = document.getElementById("peak-exposure-text");
    if (elPeak) {
      elPeak.innerHTML = `
        ⏱ <b>Peak Tariff Exposure:</b> <b>${fmtNum(peakShare, 1)}%</b> of total plant energy (<b>${Math.round(peakKwh).toLocaleString("en-IN")} kWh</b>) is consumed during peak tariff hours (18:00–22:00) costing <b>${fmtInr(peakCost)}</b> at 1.20x tariff. Moving flexible jobs to the night shift saves up to 35% on that energy.
      `;
    }

    const tbody = document.getElementById("table-operating-idle-body");
    if (tbody) {
      tbody.innerHTML = effTable.map(r => `
        <tr>
          <td><b>${r.machine_id}</b></td>
          <td>${r.machine}</td>
          <td>${Math.round(r.energy_kwh).toLocaleString("en-IN")}</td>
          <td>${r.units.toLocaleString("en-IN")}</td>
          <td><b>${r.kwh_per_unit !== null ? r.kwh_per_unit.toFixed(4) : "—"}</b></td>
          <td><span class="pill ${r.idle_share_pct > 15 ? 'pill-warning' : 'pill-healthy'}">${r.idle_share_pct}%</span></td>
        </tr>
      `).join("");
    }
  }

  function renderCarbonTab(df) {
    const c = state.carbon;
    const baseScenario = evaluateScenario(df, state.tariff);

    let fs = null;
    if (c.fuelOn) {
      const fuelSpec = CONFIG.FUELS[c.fuelType] || CONFIG.FUELS.Diesel;
      const fuelMoved = c.fuelKwh * c.fuelShare;
      const usefulHeat = fuelMoved * c.boilerEff;
      const elecKwh = c.fuelTarget === "Electric heat pump" ? usefulHeat / Math.max(c.cop, 1e-9) : 0;
      const bioCost = c.fuelTarget === "Biomass boiler" ? (usefulHeat / Math.max(c.bioEff, 1e-9)) * c.bioPrice : 0;

      fs = {
        baseCo2: c.fuelKwh * fuelSpec.co2,
        baseCost: c.fuelKwh * fuelSpec.price,
        co2Removed: fuelMoved * fuelSpec.co2,
        costRemoved: fuelMoved * fuelSpec.price,
        elecKwh,
        bioCost,
      };
    }

    const baseCo2 = baseScenario.co2_kg_month + (fs ? fs.baseCo2 : 0);
    const baseCost = baseScenario.total_inr + (fs ? fs.baseCost : 0);

    const shiftShare = {};
    for (const mid of state.selectedMachines) {
      shiftShare[mid] = (CONFIG.FLEX_DEFAULT[mid] || 0.20) * c.shift;
    }

    const twinScenario = evaluateScenario(df, state.tariff, {
      idleCut: c.idle,
      efficiencyGain: c.eff,
      shiftShare,
      solarKwp: c.solarKwp,
    }, c.greenShare);

    let newCo2 = twinScenario.co2_kg_month;
    let newCost = twinScenario.total_inr;

    if (fs) {
      newCo2 += (fs.baseCo2 - fs.co2Removed + fs.elecKwh * CONFIG.CO2_KG_PER_KWH);
      newCost += (fs.baseCost - fs.costRemoved + fs.elecKwh * state.tariff + fs.bioCost);
    }

    const co2Avoided = baseCo2 - newCo2;
    const costAvoided = baseCost - newCost;
    const achieved = (co2Avoided / Math.max(baseCo2, 1e-9));

    const elBCo2 = document.getElementById("twin-base-co2");
    if (elBCo2) elBCo2.textContent = `${Math.round(baseCo2).toLocaleString("en-IN")} kg/mo`;
    const elNCo2 = document.getElementById("twin-new-co2");
    if (elNCo2) elNCo2.textContent = `${Math.round(newCo2).toLocaleString("en-IN")} kg/mo`;
    const elCDelta = document.getElementById("twin-co2-delta");
    if (elCDelta) elCDelta.textContent = `${(achieved * -100).toFixed(1)}% reduction`;
    const elElKwh = document.getElementById("twin-electricity-kwh");
    if (elElKwh) elElKwh.textContent = `${Math.round(twinScenario.kwh_month).toLocaleString("en-IN")} kWh/mo`;
    const elPCost = document.getElementById("twin-projected-cost");
    if (elPCost) elPCost.textContent = fmtInr(newCost);
    const elPDelta = document.getElementById("twin-cost-delta");
    if (elPDelta) elPDelta.textContent = `${costAvoided >= 0 ? '-' : '+'}${fmtInr(Math.abs(costAvoided))}`;

    const targetPct = c.targetPct;
    const progressRatio = Math.min(1.0, Math.max(0, achieved / targetPct));
    const elTBar = document.getElementById("twin-target-progress-bar");
    if (elTBar) elTBar.style.width = `${progressRatio * 100}%`;
    const elTLab = document.getElementById("twin-target-label");
    if (elTLab) elTLab.textContent = `${(achieved * 100).toFixed(1)}% reduction achieved of ${(targetPct * 100).toFixed(0)}% target`;

    renderCarbonLeverChart(baseCo2, newCo2, c);
    renderCarbonTrajectoryChart(baseCo2, newCo2, c.rolloutMonths);
  }

  function renderCarbonLeverChart(baseCo2, newCo2, c) {
    if (!window.Chart) return;
    destroyChart("chart-carbon-levers");
    const levers = [
      { label: 'Idle Cut', val: Math.round(baseCo2 * c.idle * 0.15) },
      { label: 'Efficiency Upgrade', val: Math.round(baseCo2 * c.eff * 0.8) },
      { label: 'Solar Rooftop', val: Math.round(c.solarKwp * CONFIG.SOLAR_PEAK_FACTOR * 30 * CONFIG.CO2_KG_PER_KWH) },
      { label: 'Green Power PPA', val: Math.round(baseCo2 * c.greenShare * 0.7) },
    ];

    const canvas = document.getElementById("chart-carbon-levers");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-carbon-levers"] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: levers.map(l => l.label),
        datasets: [{
          label: 'kg CO₂ Avoided / month',
          data: levers.map(l => l.val),
          backgroundColor: '#15803D',
          borderRadius: 5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#1C1917', font: { weight: '600' } } },
          y: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C' } }
        }
      }
    });
  }

  function renderCarbonTrajectoryChart(baseCo2, newCo2, rolloutMonths) {
    if (!window.Chart) return;
    destroyChart("chart-carbon-trajectory");
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    let cumBase = 0;
    let cumTwin = 0;
    const baseCurve = [];
    const twinCurve = [];

    for (let m = 1; m <= 12; m++) {
      cumBase += baseCo2;
      baseCurve.push(Math.round(cumBase));
      const ramp = Math.min(1.0, m / Math.max(rolloutMonths, 1));
      const currentMonthCo2 = baseCo2 - (baseCo2 - newCo2) * ramp;
      cumTwin += currentMonthCo2;
      twinCurve.push(Math.round(cumTwin));
    }

    const canvas = document.getElementById("chart-carbon-trajectory");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-carbon-trajectory"] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months.map(m => `M${m}`),
        datasets: [{
          label: 'Business as Usual',
          data: baseCurve,
          borderColor: '#78716C',
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 0,
        }, {
          label: 'Decarbonisation Scenario',
          data: twinCurve,
          borderColor: '#15803D',
          borderWidth: 2.5,
          pointRadius: 3,
          backgroundColor: 'rgba(21, 128, 61, 0.1)',
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, color: '#1C1917' } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#78716C' } },
          y: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C' } }
        }
      }
    });
  }

  function renderSavingsPlanTab(df, beeTable, roadmap, recs, savings) {
    const elBee = document.getElementById("table-bee-benchmarks-body");
    if (elBee) {
      elBee.innerHTML = beeTable.map(r => {
        const starBadge = r.rating.includes("5-Star") ? "pill-healthy" : (r.rating.includes("3-Star") ? "pill-warning" : "pill-critical");
        return `
          <tr>
            <td><b>${r.machine_id}</b></td>
            <td>${r.machine}</td>
            <td><b>${r.kwh_per_unit !== null ? r.kwh_per_unit.toFixed(4) : "—"}</b></td>
            <td>${r.bee_5_star_target !== null ? r.bee_5_star_target.toFixed(4) : "—"}</td>
            <td><span class="pill ${starBadge}">${r.rating}</span></td>
            <td>${r.gap_to_5_star_pct > 0 ? `+${r.gap_to_5_star_pct}%` : "0%"}</td>
          </tr>
        `;
      }).join("");
    }

    const elRoad = document.getElementById("table-retrofit-roadmap-body");
    if (elRoad) {
      elRoad.innerHTML = roadmap.map(r => `
        <tr>
          <td><span class="pill pill-terracotta">${r.tier}</span></td>
          <td><b>${r.action}</b></td>
          <td>${r.equipment}</td>
          <td>${r.owner}</td>
          <td>${fmtInr(r.capex_inr)}</td>
          <td><b style="color:#15803D;">${fmtInr(r.monthly_saving_inr)}/mo</b></td>
          <td><b>${r.payback}</b></td>
          <td>${r.co2_avoided_kg} kg</td>
        </tr>
      `).join("");
    }

    const elRecs = document.getElementById("savings-action-cards-container");
    if (elRecs) {
      elRecs.innerHTML = recs.map(act => `
        <div class="action-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b style="color:#1C1917;font-size:14.5px;">${act.machine}</b>
            <span class="pill pill-terracotta">${act.category}</span>
          </div>
          <div style="font-size:13px;color:#292524;margin:6px 0;">${act.action}</div>
          <div style="font-size:12px;color:#78716C;">
            👤 <b>Owner:</b> ${act.owner} &nbsp;|&nbsp; ⏱️ <b>Effort:</b> ${act.effort} &nbsp;|&nbsp;
            <span style="color:#15803D;font-weight:700;">💰 ${act.impact}</span>
          </div>
        </div>
      `).join("");
    }

    renderAutopilotSection(df);
  }

  function renderAutopilotSection(df) {
    const ap = state.autopilot;
    const base = evaluateScenario(df, state.tariff);

    const plan = evaluateScenario(df, state.tariff, {
      idleCut: ap.idleCut,
      shiftShare: ap.flex,
      pfTarget: ap.pfTarget,
    });

    const savingMonthly = base.total_inr - plan.total_inr;
    const co2Monthly = (base.kwh_month - plan.kwh_month) * CONFIG.CO2_KG_PER_KWH;

    const elBBill = document.getElementById("ap-base-bill");
    if (elBBill) elBBill.textContent = fmtInr(base.total_inr);
    const elPBill = document.getElementById("ap-plan-bill");
    if (elPBill) elPBill.textContent = fmtInr(plan.total_inr);
    const elSavM = document.getElementById("ap-saving-month");
    if (elSavM) elSavM.textContent = fmtInr(savingMonthly);
    const elCo2M = document.getElementById("ap-co2-month");
    if (elCo2M) elCo2M.textContent = `${Math.round(co2Monthly).toLocaleString("en-IN")} kg/mo`;

    renderAutopilotLoadChart(df, plan.after);

    const tbody = document.getElementById("table-autopilot-actions-body");
    if (tbody) {
      tbody.innerHTML = state.selectedMachines.map(mid => {
        const m = MACHINE_MAP[mid];
        const flexVal = ap.flex[mid] || 0.20;
        return `
          <tr>
            <td><b>${mid} · ${m.name}</b></td>
            <td>Auto-cutoff idle after 5 mins & shift ${Math.round(flexVal * 100)}% peak loads to off-peak</td>
            <td><b style="color:#15803D;">Save ≈ ${fmtInr(savingMonthly / state.selectedMachines.length)}/mo</b></td>
          </tr>
        `;
      }).join("");
    }

    const logContainer = document.getElementById("autopilot-dispatch-log");
    if (logContainer) {
      if (ap.log.length === 0) {
        logContainer.innerHTML = `<div style="padding:12px;text-align:center;color:#78716C;font-size:12.5px;">No actions dispatched yet. Approve the plan to see simulated PLC / SCADA write-backs.</div>`;
      } else {
        logContainer.innerHTML = ap.log.slice(-10).reverse().map(l => `
          <div style="font-size:12px;padding:6px 0;border-bottom:1px solid rgba(167,65,30,0.1);">
            <span style="font-family:'JetBrains Mono',monospace;color:#78716C;">[${l.time}]</span> <b>${l.machine}:</b> ${l.action}
          </div>
        `).join("");
      }
    }
  }

  function renderAutopilotLoadChart(beforeDf, afterDf) {
    if (!window.Chart) return;
    destroyChart("chart-autopilot-load");
    const beforeKw = calculateHourlyLoadProfile(beforeDf);
    const afterKw = calculateHourlyLoadProfile(afterDf);
    const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);

    const canvas = document.getElementById("chart-autopilot-load");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    charts["chart-autopilot-load"] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hours,
        datasets: [{
          label: 'Before Autopilot',
          data: beforeKw,
          borderColor: '#78716C',
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 0,
        }, {
          label: 'With Autopilot Plan',
          data: afterKw,
          borderColor: '#15803D',
          borderWidth: 2.5,
          backgroundColor: 'rgba(21, 128, 61, 0.1)',
          fill: true,
          pointRadius: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, color: '#1C1917' } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#78716C', font: { size: 10 } } },
          y: { grid: { color: 'rgba(167, 65, 30, 0.1)' }, ticks: { color: '#78716C', font: { size: 10 } } }
        }
      }
    });
  }

  function renderDataSetupTab(df, healthScores, effTable, savings, bill, recs) {
    const btnAud = document.getElementById("btn-download-audit-report");
    if (btnAud) {
      btnAud.onclick = () => {
        generateAndPrintAuditReport(df, healthScores, effTable, savings, bill, recs);
      };
    }

    const btnTel = document.getElementById("btn-dl-telemetry");
    if (btnTel) btnTel.onclick = () => downloadCsv(df, "telemetry.csv");
    const btnHea = document.getElementById("btn-dl-health");
    if (btnHea) btnHea.onclick = () => downloadCsv(healthScores, "health_scores.csv");
    const btnEff = document.getElementById("btn-dl-eff");
    if (btnEff) btnEff.onclick = () => downloadCsv(effTable, "efficiency.csv");
  }

  function generateAndPrintAuditReport(df, healthScores, effTable, savings, bill, recs) {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to open the official printable report.");
      return;
    }
    const maxTs = df.reduce((max, r) => (r.ts > max ? r.ts : max), df[0].ts);
    const dateStr = maxTs.toLocaleDateString("en-IN", { day: '2-digit', month: 'long', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>ISO 50001 Energy Audit — ${state.user.plant}</title>
        <style>
          body { font-family: 'Plus Jakarta Sans', sans-serif; color: #1C1917; padding: 40px; line-height: 1.6; }
          h1, h2, h3 { color: #C85A32; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
          th, td { border: 1px solid #DDD; padding: 8px 12px; text-align: left; }
          th { background: #FAF5F0; }
          .kpi-box { display: inline-block; width: 22%; border: 1px solid #DDD; padding: 12px; border-radius: 8px; margin-right: 2%; vertical-align: top; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px;">
          <button onclick="window.print()" style="padding: 10px 20px; background: #C85A32; color: #FFF; border: none; border-radius: 6px; cursor: pointer; font-weight: 700;">🖨️ Print / Save as PDF</button>
        </div>
        <h1>⚡ ISO 50001 & BEE Industrial Energy Audit Report</h1>
        <p><b>Facility:</b> ${state.user.plant} &nbsp;|&nbsp; <b>Lead Auditor:</b> ${state.user.name} (${state.user.role}) &nbsp;|&nbsp; <b>Date:</b> ${dateStr}</p>
        <hr style="border:0;border-top:1px solid #C85A32;margin:20px 0;">

        <h3>1. Executive Billing & Demand Summary</h3>
        <div>
          <div class="kpi-box"><b>Projected Monthly Bill</b><br><span style="font-size:20px;font-weight:700;">${fmtInr(bill.total_inr)}</span></div>
          <div class="kpi-box"><b>Max Demand (15-min)</b><br><span style="font-size:20px;font-weight:700;">${bill.max_demand_kva} kVA</span></div>
          <div class="kpi-box"><b>Average Power Factor</b><br><span style="font-size:20px;font-weight:700;">${bill.avg_pf}</span></div>
          <div class="kpi-box"><b>Addressable Waste</b><br><span style="font-size:20px;font-weight:700;">${fmtInr(savings.total_inr)}/mo</span></div>
        </div>

        <h3 style="margin-top:30px;">2. Machine Specific Energy Consumption (SEC) & BEE Rating</h3>
        <table>
          <thead>
            <tr><th>Machine ID</th><th>Asset Name</th><th>Measured SEC (kWh/unit)</th><th>BEE 5-Star Target</th><th>Performance Classification</th></tr>
          </thead>
          <tbody>
            ${effTable.map(r => `
              <tr>
                <td>${r.machine_id}</td>
                <td>${r.machine}</td>
                <td>${r.kwh_per_unit ? r.kwh_per_unit.toFixed(4) : "—"}</td>
                <td>${r.best_kwh_per_unit ? r.best_kwh_per_unit.toFixed(4) : "—"}</td>
                <td>${r.efficiency_index ? `${r.efficiency_index}% Index` : "Support Load"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <h3>3. Recommended Corrective Action Plan</h3>
        <table>
          <thead>
            <tr><th>Equipment</th><th>Measure</th><th>Owner</th><th>Financial Impact</th></tr>
          </thead>
          <tbody>
            ${recs.map(a => `
              <tr>
                <td><b>${a.machine}</b></td>
                <td>${a.action}</td>
                <td>${a.owner}</td>
                <td style="color:#15803D;font-weight:700;">${a.impact}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div style="margin-top:50px;display:flex;justify-content:space-between;">
          <div>________________________<br><b>Plant Electrical Engineer</b></div>
          <div>________________________<br><b>Certified Energy Auditor (BEE)</b></div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  }

  function downloadCsv(data, filename) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const csvContent = [
      keys.join(","),
      ...data.map(row => keys.map(k => JSON.stringify(row[k] instanceof Date ? row[k].toISOString() : (row[k] ?? ""))).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function bindEvents() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const targetId = btn.dataset.target;
        const panel = document.getElementById(targetId);
        if (panel) panel.classList.add("active");
        state.activeTab = targetId;
        renderAll();
      });
    });

    const historySlider = document.getElementById("slider-history-hours");
    if (historySlider) {
      historySlider.addEventListener("input", e => {
        state.hours = parseInt(e.target.value, 10);
        const valEl = document.getElementById("val-history-hours");
        if (valEl) valEl.textContent = `${state.hours}h`;
        state.rawTelemetry = generateHistory(state.hours);
        processData();
        renderAll();
      });
    }

    const tariffInput = document.getElementById("input-base-tariff");
    if (tariffInput) {
      tariffInput.addEventListener("input", e => {
        state.tariff = parseFloat(e.target.value) || CONFIG.TARIFF_INR_PER_KWH;
        renderAll();
      });
    }

    const sensitivitySlider = document.getElementById("slider-sensitivity");
    if (sensitivitySlider) {
      sensitivitySlider.addEventListener("input", e => {
        state.sensitivity = parseFloat(e.target.value);
        const valEl = document.getElementById("val-sensitivity");
        if (valEl) valEl.textContent = state.sensitivity.toFixed(2);
        processData();
        renderAll();
      });
    }

    document.querySelectorAll(".machine-chips .chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const mid = chip.dataset.mid;
        if (state.selectedMachines.includes(mid)) {
          if (state.selectedMachines.length > 1) {
            state.selectedMachines = state.selectedMachines.filter(id => id !== mid);
            chip.classList.remove("active");
          }
        } else {
          state.selectedMachines.push(mid);
          chip.classList.add("active");
        }
        processData();
        renderAll();
      });
    });

    const btnAddH = document.getElementById("btn-add-hour");
    if (btnAddH) {
      btnAddH.addEventListener("click", () => {
        state.rawTelemetry = liveTick(state.rawTelemetry, 5);
        for (let i = 0; i < 11; i++) {
          state.rawTelemetry = liveTick(state.rawTelemetry, 5);
        }
        processData();
        renderAll();
      });
    }

    const btnRes = document.getElementById("btn-reset-data");
    if (btnRes) {
      btnRes.addEventListener("click", () => {
        resetRng(42);
        state.rawTelemetry = generateHistory(state.hours);
        processData();
        renderAll();
      });
    }

    const selDiag = document.getElementById("select-diag-mid");
    if (selDiag) {
      selDiag.addEventListener("change", e => {
        state.diagMid = e.target.value;
        renderMachineDiagnostics(state.filteredTelemetry, calculateHealthScores(state.filteredTelemetry));
      });
    }

    const selOut = document.getElementById("select-outlier-mid");
    if (selOut) {
      selOut.addEventListener("change", e => {
        state.outlierMid = e.target.value;
        renderOutlierSpikeChart(state.filteredTelemetry);
      });
    }

    const selFloor = document.getElementById("select-floor-metric");
    if (selFloor) {
      selFloor.addEventListener("change", e => {
        state.floorMetric = e.target.value;
        renderShopFloor(state.filteredTelemetry, calculateHealthScores(state.filteredTelemetry));
      });
    }

    const apIdle = document.getElementById("ap-slider-idle");
    if (apIdle) {
      apIdle.addEventListener("input", e => {
        state.autopilot.idleCut = parseInt(e.target.value, 10) / 100;
        const valEl = document.getElementById("ap-val-idle");
        if (valEl) valEl.textContent = `${e.target.value}%`;
        renderAutopilotSection(state.filteredTelemetry);
      });
    }

    const apPf = document.getElementById("ap-slider-pf");
    if (apPf) {
      apPf.addEventListener("input", e => {
        state.autopilot.pfTarget = parseFloat(e.target.value);
        const valEl = document.getElementById("ap-val-pf");
        if (valEl) valEl.textContent = state.autopilot.pfTarget.toFixed(2);
        renderAutopilotSection(state.filteredTelemetry);
      });
    }

    const btnApApp = document.getElementById("btn-approve-autopilot");
    if (btnApApp) {
      btnApApp.addEventListener("click", () => {
        const time = new Date().toLocaleTimeString();
        state.autopilot.log.push({ time, machine: "Plant LT Panel", action: `Hold power factor ≥ ${state.autopilot.pfTarget.toFixed(2)}` });
        state.autopilot.log.push({ time, machine: "All Machines", action: `Standby auto-cutoff programmed to 5 mins (${Math.round(state.autopilot.idleCut * 100)}% idle reduction)` });
        renderAutopilotSection(state.filteredTelemetry);
      });
    }

    const twIdle = document.getElementById("tw-slider-idle");
    if (twIdle) {
      twIdle.addEventListener("input", e => {
        state.carbon.idle = parseInt(e.target.value, 10) / 100;
        const valEl = document.getElementById("tw-val-idle");
        if (valEl) valEl.textContent = `${e.target.value}%`;
        renderCarbonTab(state.filteredTelemetry);
      });
    }

    const twEff = document.getElementById("tw-slider-eff");
    if (twEff) {
      twEff.addEventListener("input", e => {
        state.carbon.eff = parseInt(e.target.value, 10) / 100;
        const valEl = document.getElementById("tw-val-eff");
        if (valEl) valEl.textContent = `${e.target.value}%`;
        renderCarbonTab(state.filteredTelemetry);
      });
    }

    const twSol = document.getElementById("tw-slider-solar");
    if (twSol) {
      twSol.addEventListener("input", e => {
        state.carbon.solarKwp = parseInt(e.target.value, 10);
        const valEl = document.getElementById("tw-val-solar");
        if (valEl) valEl.textContent = `${state.carbon.solarKwp} kWp`;
        renderCarbonTab(state.filteredTelemetry);
      });
    }

    const twGrn = document.getElementById("tw-slider-green");
    if (twGrn) {
      twGrn.addEventListener("input", e => {
        state.carbon.greenShare = parseInt(e.target.value, 10) / 100;
        const valEl = document.getElementById("tw-val-green");
        if (valEl) valEl.textContent = `${e.target.value}%`;
        renderCarbonTab(state.filteredTelemetry);
      });
    }

    const twRoll = document.getElementById("tw-slider-rollout");
    if (twRoll) {
      twRoll.addEventListener("input", e => {
        state.carbon.rolloutMonths = parseInt(e.target.value, 10);
        const valEl = document.getElementById("tw-val-rollout");
        if (valEl) valEl.textContent = `${state.carbon.rolloutMonths} months`;
        renderCarbonTab(state.filteredTelemetry);
      });
    }

    const dropZone = document.getElementById("csv-drop-zone");
    const fileInput = document.getElementById("csv-file-input");
    if (dropZone && fileInput) {
      dropZone.addEventListener("click", () => fileInput.click());
      dropZone.addEventListener("dragover", e => {
        e.preventDefault();
        dropZone.style.borderColor = "#C85A32";
      });
      dropZone.addEventListener("dragleave", () => {
        dropZone.style.borderColor = "rgba(167, 65, 30, 0.3)";
      });
      dropZone.addEventListener("drop", e => {
        e.preventDefault();
        dropZone.style.borderColor = "rgba(167, 65, 30, 0.3)";
        if (e.dataTransfer.files.length) handleCsvUpload(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener("change", e => {
        if (e.target.files.length) handleCsvUpload(e.target.files[0]);
      });
    }
  }

  function handleCsvUpload(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const lines = text.split("\n").filter(l => l.trim().length > 0);
      if (lines.length < 2) return;
      const headers = lines[0].split(",");
      const statusEl = document.getElementById("csv-upload-status");
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="color:#15803D;font-weight:700;">✅ File "${file.name}" parsed successfully: ${lines.length - 1} records found. Columns: ${headers.slice(0, 5).join(", ")}...</div>
        `;
      }
    };
    reader.readAsText(file);
  }

  function start() {
    state.rawTelemetry = generateHistory(state.hours);
    processData();
    bindEvents();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

