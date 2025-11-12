// utils/PredictionEngine.js

class PredictionEngine {
    constructor(visits, patient) {
        this.visits = visits || [];
        this.patient = patient || {};
        this.validatedVisits = this.validateVisits(this.visits);
    }

    validateVisits(visits) {
        if (!visits || !Array.isArray(visits)) return [];

        return visits
            .map(visit => ({
                GESTATIONAL_AGE_WEEKS: visit.GESTATIONAL_AGE_WEEKS || null,
                MATERNAL_WEIGHT: visit.MATERNAL_WEIGHT || null,
                FUNDAL_HEIGHT: visit.FUNDAL_HEIGHT || null,
                HEMOGLOBIN_LEVEL: visit.HEMOGLOBIN_LEVEL || null,
                BLOOD_PRESSURE: visit.BLOOD_PRESSURE || null,
                FETAL_HEART_RATE: visit.FETAL_HEART_RATE || null,
                COMPLICATIONS: visit.COMPLICATIONS || null,
                VISIT_DATE: visit.VISIT_DATE || null
            }))
            .filter(visit => visit.GESTATIONAL_AGE_WEEKS && visit.GESTATIONAL_AGE_WEEKS > 0);
    }

    calculateExpectedDelivery(riskScores, deliveryType) {
        let expectedGA = 39.2; // Start with a healthy full-term average
        let expectedWeight = 3.3; // Start with a healthy weight in kg

        // Adjust GA based on delivery type probability
        if (deliveryType.Premature > 0.3) {
            expectedGA = 36.5;
        } else if (deliveryType.Premature > 0.15) {
            expectedGA = 38.0;
        }

        // Adjust Weight based on major risks
        if (riskScores.growthRestriction > 0.5) {
            expectedWeight -= 0.5; // Significant impact
        }
        if (riskScores.hypertension > 0.5) {
            expectedWeight -= 0.3;
        }
        if (riskScores.anemia > 0.5) {
            expectedWeight -= 0.2;
        }
        if (expectedGA < 37.5) {
            expectedWeight -= 0.4; // Adjust for prematurity
        }

        // Clamp values to realistic ranges
        expectedGA = Math.min(40.0, Math.max(35.0, expectedGA));
        expectedWeight = Math.min(4.0, Math.max(2.5, expectedWeight));

        return {
            expectedGestationalAge: this.roundValue(expectedGA, 1),
            expectedBirthWeight: this.roundValue(expectedWeight, 1)
        };
    }

    generatePrediction() {
        if (this.validatedVisits.length === 0) {
            return this.getFallbackPrediction();
        }

        // Sort visits by GA to get the latest one
        this.validatedVisits.sort((a, b) => a.GESTATIONAL_AGE_WEEKS - b.GESTATIONAL_AGE_WEEKS);
        const latestVisit = this.validatedVisits[this.validatedVisits.length - 1];
        const currentGA = latestVisit.GESTATIONAL_AGE_WEEKS;

        // Project up to 40 weeks
        const weeksToProject = Math.max(0, 40 - currentGA);

        if (weeksToProject <= 0) {
            // If we are at/past 40 weeks, return a fallback with no progression
            return this.getFallbackPrediction(true);
        }

        const riskScores = this.calculateRiskScores();
        const deliveryType = this.calculateDeliveryTypeProbabilities(riskScores);
        const deliveryMode = this.calculateDeliveryModeProbabilities(riskScores);

        const { expectedGestationalAge, expectedBirthWeight } = this.calculateExpectedDelivery(riskScores, deliveryType);

        const progression = this.generateProgression(currentGA, weeksToProject);
        const summary = this.generateSummary(riskScores, deliveryType, deliveryMode);

        return {
            deliveryType,
            deliveryMode,
            progression,
            summary,
            expectedGestationalAge,
            expectedBirthWeight,
            riskScores,
            metadata: {
                currentGestationalAge: currentGA,
                weeksProjected: weeksToProject,
                visitCount: this.validatedVisits.length,
                generatedAt: new Date().toISOString(),
                source: "rule-based-engine"
            }
        };
    }

    calculateRiskScores() {
        const latestVisit = this.validatedVisits[this.validatedVisits.length - 1];
        const scores = {
            anemia: 0,
            hypertension: 0,
            growthRestriction: 0,
            pretermRisk: 0,
            maternalAgeRisk: 0,
            bmiRisk: 0
        };

        // Anemia Risk
        if (latestVisit.HEMOGLOBIN_LEVEL) {
            if (latestVisit.HEMOGLOBIN_LEVEL < 10) scores.anemia = 0.8;
            else if (latestVisit.HEMOGLOBIN_LEVEL < 11) scores.anemia = 0.4;
            else scores.anemia = 0.1;
        }

        // Hypertension Risk
        if (latestVisit.BLOOD_PRESSURE) {
            const bp = this.parseBloodPressure(latestVisit.BLOOD_PRESSURE);
            if (bp.systolic >= 140 || bp.diastolic >= 90) scores.hypertension = 0.9;
            else if (bp.systolic >= 130 || bp.diastolic >= 85) scores.hypertension = 0.6;
            else scores.hypertension = 0.1;
        }

        // Growth Restriction Risk
        if (latestVisit.FUNDAL_HEIGHT && latestVisit.GESTATIONAL_AGE_WEEKS) {
            const diff = Math.abs(latestVisit.FUNDAL_HEIGHT - latestVisit.GESTATIONAL_AGE_WEEKS);
            if (diff > 4) scores.growthRestriction = 0.7;
            else if (diff > 2) scores.growthRestriction = 0.3;
            else scores.growthRestriction = 0.1;
        }

        // Preterm Risk
        const currentGA = latestVisit.GESTATIONAL_AGE_WEEKS;
        if (currentGA < 37 && this.hasPretermHistory()) scores.pretermRisk = 0.6;
        else if (currentGA < 32) scores.pretermRisk = 0.3;
        else scores.pretermRisk = 0.1;

        // Maternal Age Risk
        const age = this.patient.AGE || 25;
        if (age < 18 || age > 35) scores.maternalAgeRisk = 0.4;
        else scores.maternalAgeRisk = 0.1;

        // BMI Risk
        const bmi = this.patient.BMI_VALUE;
        if (bmi) {
            if (bmi < 18.5 || bmi > 30) scores.bmiRisk = 0.5;
            else if (bmi > 25) scores.bmiRisk = 0.3;
            else scores.bmiRisk = 0.1;
        }

        return scores;
    }

    calculateDeliveryTypeProbabilities(riskScores) {
        const totalRisk = Object.values(riskScores).reduce((a, b) => a + b, 0) / Object.keys(riskScores).length;

        let fullTerm = Math.max(0.4, 0.80 - (totalRisk * 0.3));
        let premature = Math.min(0.4, 0.15 + (totalRisk * 0.2));
        let mortalityRisk = Math.min(0.2, 0.05 + (totalRisk * 0.1));

        const sum = fullTerm + premature + mortalityRisk;
        fullTerm /= sum;
        premature /= sum;
        mortalityRisk /= sum;

        return {
            FullTerm: this.roundProbability(fullTerm),
            Premature: this.roundProbability(premature),
            MortalityRisk: this.roundProbability(mortalityRisk)
        };
    }

    calculateDeliveryModeProbabilities(riskScores) {
        const cSectionRisk = Math.min(0.7,
            riskScores.hypertension * 0.4 +
            riskScores.growthRestriction * 0.3 +
            riskScores.bmiRisk * 0.2 +
            ((this.patient.PARITY === 0 || this.patient.PARITY === '0') ? 0.1 : 0)
        );

        return {
            Normal: this.roundProbability(1 - cSectionRisk),
            CSection: this.roundProbability(cSectionRisk)
        };
    }

    generateProgressionData(startWeek, weeksToProject, baseVitals) {
        // ... (this function is unchanged from your file) ...
        const progression = {
            weight: [],
            fundal: [],
            hb: [],
            systolic: [],
            diastolic: [],
            fetal_hr: [],
        };

        for (let i = 1; i <= weeksToProject; i++) {
            const week = startWeek + i;
            progression.weight.push({
                week,
                value: this.roundValue(baseVitals.weight + (i * 0.35), 1),
            });
            progression.fundal.push({
                week,
                value: this.roundValue(week + (Math.random() * 2 - 1), 1),
            });
            progression.hb.push({
                week,
                value: this.roundValue(Math.max(10.5, baseVitals.hb - (i * 0.05)), 1),
            });
            progression.systolic.push({
                week,
                value: Math.round(baseVitals.bp.systolic + i * 0.25 + (Math.random() * 2 - 1)),
            });
            progression.diastolic.push({
                week,
                value: Math.round(baseVitals.bp.diastolic + i * 0.15 + (Math.random() * 2 - 1)),
            });
            let fhrValue = baseVitals.fhr + Math.sin(i / 3) * 2 + (Math.random() * 3 - 1.5);
            fhrValue = Math.min(160, Math.max(120, fhrValue));
            progression.fetal_hr.push({
                week,
                value: Math.round(fhrValue),
            });
        }
        return progression;
    }

    generateProgression(currentGA, weeksToProject) {
        // ... (this function is unchanged from your file) ...
        const latest = this.validatedVisits.at(-1);
        const bp = this.parseBloodPressure(latest.BLOOD_PRESSURE);

        const base = {
            weight: latest.MATERNAL_WEIGHT || 60,
            fundal: latest.FUNDAL_HEIGHT || currentGA,
            hb: latest.HEMOGLOBIN_LEVEL || 11.5,
            fhr: latest.FETAL_HEART_RATE || 145,
            bp: bp,
        };

        const weightTrend = this.calculateTrend("MATERNAL_WEIGHT");
        const hbTrend = this.calculateTrend("HEMOGLOBIN_LEVEL");

        const progression = this.generateProgressionData(currentGA, weeksToProject, base);

        progression.weight.forEach(p => p.value += (p.week - currentGA) * (weightTrend * 0.1));
        progression.hb.forEach(p => p.value += (p.week - currentGA) * (hbTrend * 0.02));

        return progression;
    }


    calculateWeightGain(week, baseWeight, trend) {
        // ... (this function is unchanged from your file) ...
        if (this.validatedVisits.length < 1) return baseWeight + (week * 0.35);
        const baseGain = 0.3;
        const patientSpecificGain = baseGain + (trend * 0.1);
        const weeksFromStart = week - this.validatedVisits[0].GESTATIONAL_AGE_WEEKS;
        return baseWeight + (weeksFromStart * patientSpecificGain);
    }

    calculateHbDecline(week, baseHb, trend) {
        // ... (this function is unchanged from your file) ...
        if (this.validatedVisits.length < 1) return Math.max(9.5, baseHb - (week * 0.05));
        const baseDecline = 0.05;
        const patientSpecificDecline = baseDecline + (trend * 0.02);
        const weeksFromStart = week - this.validatedVisits[0].GESTATIONAL_AGE_WEEKS;
        return Math.max(9.5, baseHb - (weeksFromStart * patientSpecificDecline));
    }

    calculateTrend(field) {
        // ... (this function is unchanged from your file) ...
        if (this.validatedVisits.length < 2) return 0;
        const sortedVisits = [...this.validatedVisits].sort((a, b) => a.GESTATIONAL_AGE_WEEKS - b.GESTATIONAL_AGE_WEEKS);
        const first = sortedVisits[0][field];
        const last = sortedVisits[sortedVisits.length - 1][field];
        if (!first || !last) return 0;
        const weekDiff = sortedVisits[sortedVisits.length - 1].GESTATIONAL_AGE_WEEKS - sortedVisits[0].GESTATIONAL_AGE_WEEKS;
        return weekDiff > 0 ? (last - first) / weekDiff : 0;
    }

    parseBloodPressure(bpString) {
        // ... (this function is unchanged from your file) ...
        if (!bpString) return { systolic: 115, diastolic: 70 };
        try {
            const parts = bpString.split('/').map(Number);
            return {
                systolic: parts[0] || 115,
                diastolic: parts[1] || 70
            };
        } catch (error) {
            return { systolic: 115, diastolic: 70 };
        }
    }

    hasPretermHistory() {
        // ... (this function is unchanged from your file) ...
        return (this.patient.PARITY > 0 || this.patient.PARITY === '1') &&
            this.patient.MEDICAL_HISTORY?.toLowerCase().includes('preterm');
    }

    generateSummary(riskScores, deliveryType, deliveryMode) {
        // ... (this function is unchanged from your file) ...
        const primaryRisk = Object.entries(riskScores).reduce((a, b) => a[1] > b[1] ? a : b)[0];
        const riskLevel = riskScores[primaryRisk] > 0.7 ? 'high' : riskScores[primaryRisk] > 0.4 ? 'moderate' : 'low';
        const fullTermPercent = Math.round(deliveryType.FullTerm * 100);
        const prematurePercent = Math.round(deliveryType.Premature * 100);
        const summaries = {
            low: `Patient shows stable progression with ${fullTermPercent}% likelihood of full-term normal delivery. Continue routine antenatal monitoring.`,
            moderate: `Moderate ${this.formatRiskName(primaryRisk)} risk noted. ${fullTermPercent}% chance of full-term delivery with increased monitoring recommended.`,
            high: `Elevated ${this.formatRiskName(primaryRisk)} risk requires close monitoring. ${prematurePercent}% premature delivery risk. Consider specialist consultation.`
        };
        return summaries[riskLevel] || summaries.low;
    }

    formatRiskName(riskKey) {
        // ... (this function is unchanged from your file) ...
        const names = {
            anemia: 'anemia',
            hypertension: 'hypertension',
            growthRestriction: 'fetal growth restriction',
            pretermRisk: 'preterm delivery',
            maternalAgeRisk: 'maternal age',
            bmiRisk: 'BMI-related'
        };
        return names[riskKey] || riskKey;
    }

    roundProbability(value) {
        // ... (this function is unchanged from your file) ...
        return Math.round(value * 100) / 100;
    }

    roundValue(value, decimals = 2) {
        // ... (this function is unchanged from your file) ...
        return Number(value.toFixed(decimals));
    }

    getFallbackPrediction(atTerm = false) {
        // ... (this function is unchanged from your file) ...
        const defaultGA = 12;
        const weeksToProject = atTerm ? 0 : (40 - defaultGA);
        const baseVitals = {
            weight: 60,
            fundal: 12,
            hb: 11.5,
            fhr: 145,
            bp: { systolic: 115, diastolic: 70 }
        };
        const progression = atTerm ? {} : this.generateProgressionData(defaultGA, weeksToProject, baseVitals);
        return {
            deliveryType: { "FullTerm": 0.80, "Premature": 0.15, "MortalityRisk": 0.05 },
            deliveryMode: { "Normal": 0.70, "CSection": 0.30 },
            progression: progression,
            summary: "Using standard pregnancy progression model - insufficient patient data for personalized prediction.",
            expectedGestationalAge: 39.0,
            expectedBirthWeight: 3.2,
            riskScores: {},
            isFallback: true,
            metadata: {
                source: "fallback-model",
                generatedAt: new Date().toISOString()
            }
        };
    }
}

// ⭐️⭐️⭐️ START OF MODIFICATIONS ⭐️⭐️⭐️
export class BMIAverageCalculator {

    // ⭐️ NEW: Define the weeks that correspond to the 15 and 16-value arrays
    static WEEKS_15 = [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40];
    static WEEKS_16 = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40];

    // ⭐️ NEW: This function formats the raw data for recharts
    static getFormattedAverages(bmiStatus) {
        const rawAverages = this.getBMIAverages(bmiStatus || 'Normal');

        // Helper to zip weeks and values together
        const zipData = (weeks, values, key) => {
            return weeks.map((week, index) => ({
                GESTATIONAL_AGE_WEEKS: week,
                [key]: values[index]
            }));
        };

        const averageWeight = zipData(this.WEEKS_16, rawAverages.weight, 'AVG_WEIGHT');
        const averageFundal = zipData(this.WEEKS_15, rawAverages.fundal, 'AVG_FUNDAL');
        const averageHemoglobin = zipData(this.WEEKS_15, rawAverages.hemoglobin, 'AVG_HB');

        // For BP, we combine systolic and diastolic into one array of objects
        const averageBloodPressure = this.WEEKS_15.map((week, index) => ({
            GESTATIONAL_AGE_WEEKS: week,
            AVG_SYSTOLIC: rawAverages.systolic[index],
            AVG_DIASTOLIC: rawAverages.diastolic[index]
        }));

        return {
            averageWeight,
            averageFundal,
            averageHemoglobin,
            averageBloodPressure
        };
    }

    static getBMIAverages(bmiStatus) {
        // ... (This function is unchanged from your file) ...
        const averages = {
            Underweight: {
                weight: [50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80],
                fundal: [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40],
                hemoglobin: [12.0, 11.8, 11.6, 11.4, 11.2, 11.0, 10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4, 9.2],
                systolic: [110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134, 136, 138],
                diastolic: [70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84]
            },
            Normal: {
                weight: [55, 57, 59, 61, 63, 65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85],
                fundal: [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40],
                hemoglobin: [12.2, 12.0, 11.8, 11.6, 11.4, 11.2, 11.0, 10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4],
                systolic: [115, 117, 119, 121, 123, 125, 127, 129, 131, 133, 135, 137, 139, 141, 143],
                diastolic: [70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84]
            },
            Overweight: {
                weight: [65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85, 87, 89, 91, 93, 95],
                fundal: [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40],
                hemoglobin: [11.8, 11.6, 11.4, 11.2, 11.0, 10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4, 9.2, 9.0],
                systolic: [120, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 142, 144, 146, 148],
                diastolic: [75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89]
            },
            Obese: {
                weight: [75, 77, 79, 81, 83, 85, 87, 89, 91, 93, 95, 97, 99, 101, 103, 105],
                fundal: [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40],
                hemoglobin: [11.5, 11.3, 11.1, 10.9, 10.7, 10.5, 10.3, 10.1, 9.9, 9.7, 9.5, 9.3, 9.1, 8.9, 8.7],
                systolic: [125, 127, 129, 131, 133, 135, 137, 139, 141, 143, 145, 147, 149, 151, 153],
                diastolic: [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94]
            }
        };

        return averages[bmiStatus] || averages.Normal;
    }

    static calculateDeviation(patientData, bmiStatus, metric) {
        // ... (This function is unchanged from your file) ...
        const averages = this.getBMIAverages(bmiStatus);
        const averageValues = averages[metric];
        return patientData.map((dataPoint, index) => {
            if (index >= averageValues.length) return null;
            const patientValue = dataPoint[this.getMetricKey(metric)];
            const averageValue = averageValues[index];
            if (!patientValue) return null;
            return {
                week: dataPoint.GESTATIONAL_AGE_WEEKS,
                patientValue,
                averageValue,
                deviation: patientValue - averageValue,
                deviationPercent: ((patientValue - averageValue) / averageValue) * 100
            };
        }).filter(item => item !== null);
    }

    static getMetricKey(metric) {
        // ... (This function is unchanged from your file) ...
        const keys = {
            weight: 'MATERNAL_WEIGHT',
            fundal: 'FUNDAL_HEIGHT',
            hemoglobin: 'HEMOGLOBIN_LEVEL',
            systolic: 'BP_SYSTOLIC',
            diastolic: 'BP_DIASTOLIC'
        };
        return keys[metric];
    }
}
// ⭐️⭐️⭐️ END OF MODIFICATIONS ⭐️⭐️⭐️


export default PredictionEngine;