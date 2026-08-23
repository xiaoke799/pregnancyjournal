const fs = require('fs');
const path = require('path');

// Fix recipes.json
const recipesPath = path.join(__dirname, 'recipes.json');
let raw = fs.readFileSync(recipesPath, 'utf-8');

// The file has valid JSON array followed by garbage. Extract the valid part.
// Find the last valid array close
let bestValid = null;
let bestEnd = 0;

for (let i = raw.length - 1; i >= 0; i--) {
  if (raw[i] === ']') {
    const candidate = raw.substring(0, i + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length > 0) {
        bestValid = parsed;
        bestEnd = i + 1;
        break;
      }
    } catch {
      // try stripping trailing comma
      const lastComma = candidate.lastIndexOf(',');
      if (lastComma > 0) {
        const trimmed = candidate.substring(0, lastComma) + ']';
        try {
          const parsed2 = JSON.parse(trimmed);
          if (Array.isArray(parsed2) && parsed2.length > 0) {
            bestValid = parsed2;
            bestEnd = lastComma + 1;
            break;
          }
        } catch {}
      }
    }
  }
}

if (bestValid) {
  fs.writeFileSync(recipesPath, JSON.stringify(bestValid, null, 2), 'utf-8');
  console.log('recipes.json fixed, entries:', bestValid.length);
} else {
  console.log('Could not fix recipes.json');
}

// Fix food_safety_v3.json
const foodPath = path.join(__dirname, 'food_safety_v3.json');
raw = fs.readFileSync(foodPath, 'utf-8');

bestValid = null;
for (let i = raw.length - 1; i >= 0; i--) {
  if (raw[i] === '}') {
    const candidate = raw.substring(0, i + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.categories) {
        bestValid = parsed;
        break;
      }
    } catch {}
  }
}

if (bestValid) {
  fs.writeFileSync(foodPath, JSON.stringify(bestValid, null, 2), 'utf-8');
  console.log('food_safety_v3.json fixed, categories:', bestValid.categories?.length);
} else {
  console.log('Could not fix food_safety_v3.json');
}
