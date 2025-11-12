// ⭐️ Renamed from 'aiserver 1.js'
import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
// ⭐️ Import the new PredictionEngine
import PredictionEngine, { BMIAverageCalculator } from "./PredictionEngine.js";


dotenv.config();
const router = express.Router();

// ✅ Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===============================
// 🤖 AI: Delivery Insight Endpoint
// ===============================
router.post("/insight", async (req, res) => {
    try {
        const { visits = [], patient = {}, deliveries = [], babies = [] } = req.body;

        if (!Array.isArray(visits) || visits.length === 0) {
            return res.status(400).json({ success: false, error: "No visit data provided" });
        }

        const latestVisit = visits.at(-1);
        const latestDelivery = deliveries.at(-1) || {};
        const latestBaby = babies.at(-1) || {};

        const prompt = `
You are an experienced **maternal health AI specialist**.
Analyze this delivery data and provide:
1. Why this delivery type (Normal / C-section / Premature / Mortality) occurred.
2. Predict mother and baby recovery / risks.
3. Provide a concise medical-style summary.

**PATIENT SUMMARY**
- Name: ${patient?.FIRST_NAME || "Unknown"} ${patient?.LAST_NAME || ""}
- Age: ${patient?.DATE_OF_BIRTH || "Unknown"}
- BMI: ${patient?.BMI_VALUE || "Unknown"} (${patient?.BMI_STATUS || "N/A"})
- Gravida/Parity: G${patient?.GRAVIDA || "?"}, P${patient?.PARITY || "?"}
- Medical History: ${patient?.MEDICAL_HISTORY || "None"}
- Blood Type: ${patient?.BLOOD_TYPE || "Unknown"}

**DELIVERY DETAILS**
- Mode: ${latestDelivery?.DELIVERY_MODE || "Unknown"}
- GA at Delivery: ${latestDelivery?.GESTATIONAL_AGE_AT_DELIVERY || "Unknown"} weeks
- Complications: ${latestDelivery?.DELIVERY_COMPLICATIONS || "None"}
- Post-Delivery Condition: ${latestDelivery?.MOTHER_CONDITION_POST_DELIVERY || "Unknown"}
- Stay: ${latestDelivery?.LENGTH_OF_STAY || "Unknown"} days

**BABY**
- Sex: ${latestBaby?.BABY_SEX || "Unknown"}
- Weight: ${latestBaby?.BIRTH_WEIGHT || "Unknown"} kg
- APGAR: ${latestBaby?.APGAR_SCORE_1MIN || "?"} (1m), ${latestBaby?.APGAR_SCORE_5MIN || "?"} (5m)
- NICU: ${latestBaby?.NICU_ADMISSION || "Unknown"}
- Complications: ${latestBaby?.NEONATAL_COMPLICATIONS || "None"}

**LATEST VISIT**
- GA: ${latestVisit?.GESTATIONAL_AGE_WEEKS || "N/A"} weeks
- BP: ${latestVisit?.BLOOD_PRESSURE || "N/A"}
- Hb: ${latestVisit?.HEMOGLOBIN_LEVEL || "N/A"} g/dL
- Fundal Height: ${latestVisit?.FUNDAL_HEIGHT || "N/A"} cm
- Complications: ${latestVisit?.COMPLICATIONS || "None"}

Provide:
- Why this delivery type occurred  
- Mother prognosis  
- Baby prognosis  
- One-line summary
`;

        // ⭐️ We will fix this model name after the debugging code runs
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(prompt);
        const text = result?.response?.text?.() || "⚠️ No response from Gemini.";

        res.json({ success: true, source: "gemini", insight: text.trim() });
    } catch (error) {
        console.error("❌ AI Insight Error:", error);
        res.status(500).json({ success: false, error: "Failed to generate AI insight" });
    }
});

// ===============================
// 🤖 AI: Ongoing Pregnancy Insight
// ===============================
router.post("/ongoing-insight", async (req, res) => {
    try {
        const { visits = [], patient = {} } = req.body;

        if (!Array.isArray(visits) || visits.length === 0) {
            return res.status(400).json({ success: false, error: "No visit data provided." });
        }

        const visitSummary = visits
            .map(
                (v, i) => `
Visit ${i + 1}:
- GA: ${v.GESTATIONAL_AGE_WEEKS || "N/A"} weeks
- BP: ${v.BLOOD_PRESSURE || "N/A"}
- Hb: ${v.HEMOGLOBIN_LEVEL || "N/A"} g/dL
- Fundal Height: ${v.FUNDAL_HEIGHT || "N/A"} cm
- Weight: ${v.MATERNAL_WEIGHT || "N/A"} kg
- Complications: ${v.COMPLICATIONS || "None"}`
            )
            .join("\n");

        const prompt = `
You are an **AI obstetric health specialist** monitoring pregnancy.
Analyze full history and predict:
1. Delivery type (Normal / C-section / Premature / Risk)
2. Risks or warning signs
3. Precautions for upcoming weeks
4. One-line summary with advice.

**PATIENT SUMMARY**
${JSON.stringify(patient, null, 2)}

**VISIT HISTORY**
${visitSummary}
`;

        // ⭐️ We will fix this model name after the debugging code runs
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(prompt);
        const text = result?.response?.text?.() || "⚠️ No AI response.";

        res.json({ success: true, source: "gemini", insight: text.trim() });
    } catch (error) {
        console.error("❌ Ongoing Insight Error:", error);
        res.status(500).json({ success: false, error: "Failed to generate ongoing insight." });
    }
});

// ===============================
// 🤖 AI + Rule-Based Progression Prediction
// ===============================
router.post("/ongoing-progression", async (req, res) => {
    try {
        const { visits = [], patient = {} } = req.body;

        console.log("🎯 RULE-BASED PREDICTION ENGINE");
        console.log("Patient ID:", patient.PATIENT_ID || "Unknown");
        console.log("Total Visits:", visits.length);

        // ⭐️ Use the PredictionEngine class
        const engine = new PredictionEngine(visits, patient);
        const prediction = engine.generatePrediction();

        // ⭐️ NEW: Get formatted average data based on patient's BMI
        const bmiStatus = patient.BMI_STATUS || "Normal"; // Fallback to "Normal"
        console.log(`📊 Calculating averages for BMI Status: ${bmiStatus}`);
        const averages = BMIAverageCalculator.getFormattedAverages(bmiStatus);

        console.log("✅ Prediction:", prediction.summary);

        // ⭐️ MODIFIED: Add the 'averages' object to the response
        res.json({ success: true, ...prediction, averages });

    } catch (error) {
        console.error("❌ Prediction error:", error);
        const engine = new PredictionEngine([], {}); // Get fallback
        const fallback = engine.getFallbackPrediction();

        // ⭐️ MODIFIED: Also add empty averages to the fallback response
        res.json({
            success: true,
            ...fallback,
            averages: {
                averageWeight: [],
                averageFundal: [],
                averageHemoglobin: [],
                averageBloodPressure: []
            },
            error: error.message
        });
    }
});

// ===========================
// 🥗 AI Diet Recommendation
// ===========================
router.post("/diet-plan", async (req, res) => {
    try {
        const { patient = {}, visits = [] } = req.body;
        const latestVisit = visits[visits.length - 1] || {};

        const prompt = `
You are a certified maternal nutrition specialist AI.
Create a **7-day personalized diet plan** for a pregnant woman based on her health data.

---

**PATIENT PROFILE**
- Age: ${patient.AGE || "N/A"}
- BMI: ${patient.BMI_VALUE || "N/A"} (${patient.BMI_STATUS || "Unknown"})
- Gestational Age: ${latestVisit.GESTATIONAL_AGE_WEEKS || "N/A"} weeks
- Hemoglobin Level: ${latestVisit.HEMOGLOBIN_LEVEL || "N/A"} g/dL
- Blood Pressure: ${latestVisit.BLOOD_PRESSURE || "N/A"}
- Complications: ${latestVisit.COMPLICATIONS || "None"}
- Medical History: ${patient.MEDICAL_HISTORY || "None"}
- Food Preferences: ${patient.DIET_TYPE || "Not specified"} (e.g., Veg / Non-veg)

---

**TASKS**
1. Recommend a **daily diet plan (Breakfast, Lunch, Snack, Dinner)** for 7 days.  
2. Include **protein, iron, calcium, and hydration** suggestions.  
3. If anemic or low BMI → focus on iron & calorie-rich foods.  
4. Keep meals realistic for Indian households.  
5. Provide a **short nutritional tip summary** at the end.

**Example Output (structured text):**
Day 1:
- Breakfast: Oats with milk & banana  
- Lunch: Brown rice, dal, spinach curry  
- Snack: Roasted chana + lemon water  
- Dinner: Chapati, paneer curry, salad  
Tip: Stay hydrated and include citrus fruits for iron absorption. and dont say ok this is your like don't want just directly tell that
`;

        // ⭐️ We will fix this model name after the debugging code runs
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(prompt);
        const text = result?.response?.text?.() || "⚠️ No AI response";

        res.json({ success: true, source: "gemini", dietPlan: text.trim() });
    } catch (error) {
        console.error("❌ Diet Plan Error:", error);
        res.status(500).json({ success: false, error: "Failed to generate diet plan" });
    }
});

// ===========================
// 🧘‍♀️ AI Exercise & Wellness Plan
// ===========================
router.post("/exercise-plan", async (req, res) => {
    try {
        const { patient = {}, visits = [] } = req.body;
        const latestVisit = visits[visits.length - 1] || {};

        const prompt = `
You are an AI maternal fitness coach.
Create a **safe weekly exercise & lifestyle plan** for a pregnant woman based on her health profile.

---

**PATIENT PROFILE**
- Age: ${patient.AGE || "N/A"}
- Gestational Age: ${latestVisit.GESTATIONAL_AGE_WEEKS || "N/A"} weeks
- BMI: ${patient.BMI_VALUE || "N/A"} (${patient.BMI_STATUS || "Unknown"})
- Blood Pressure: ${latestVisit.BLOOD_PRESSURE || "N/A"}
- Hemoglobin: ${latestVisit.HEMOGLOBIN_LEVEL || "N/A"} g/dL
- Complications: ${latestVisit.COMPLICATIONS || "None"}
- Previous Pregnancy: G${patient.GRAVIDA || "?"}, P${patient.PARITY || "?"}
- Activity Level: ${patient.ACTIVITY_LEVEL || "Moderate"}

---

**TASKS**
1. Recommend safe **daily exercises or activities** (walking, stretching, yoga, breathing, etc.).  
2. Include **precautions** (e.g., avoid lying flat after 20 weeks, avoid lifting heavy).  
3. Add **1-2 mindfulness or relaxation suggestions**.  
4. End with a **short summary paragraph** of overall advice.

**Example Output (structured text):**
Day 1: 20 min brisk walk + 10 min pelvic floor stretch  
Day 2: Prenatal yoga + breathing  
Day 3: Light household activity, rest in the afternoon  
Precautions: Avoid supine position after 20 weeks.  
Tip: Consistency > intensity. Gentle movement helps reduce swelling & improve sleep.
 and dont say ok this is your like dont wan't just directly tell that

`;

        // ⭐️ We will fix this model name after the debugging code runs
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(prompt);
        const text = result?.response?.text?.() || "⚠️ No AI response";

        res.json({ success: true, source: "gemini", exercisePlan: text.trim() });
    } catch (error) {
        console.error("❌ Exercise Plan Error:", error);
        res.status(500).json({ success: false, error: "Failed to generate exercise plan" });
    }
});

export default router;