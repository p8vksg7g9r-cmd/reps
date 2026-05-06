// Starter exercise list. Names are intentional and must not be paraphrased.
// `standardKey` points into strength-standards.js (null = no benchmark available).

export const STARTER_EXERCISES = [
  // Standard set type (3 rounds: work / rest / work / rest / work)
  { name: "Lat Pulldown",                       setType: "standard",  rounds: 3, standardKey: "lat_pulldown" },
  { name: "Chest-Supported Row",                setType: "standard",  rounds: 3, standardKey: "chest_supported_row" },
  { name: "Incline Chest Press 30°",            setType: "standard",  rounds: 3, standardKey: "incline_chest_press" },
  { name: "Adductor Machine",                   setType: "standard",  rounds: 3, standardKey: null },
  { name: "Abductor Machine",                   setType: "standard",  rounds: 3, standardKey: null },
  { name: "Standing Dumbbell Press",            setType: "standard",  rounds: 3, standardKey: "db_shoulder_press" },
  { name: "Lateral Raises",                     setType: "standard",  rounds: 3, standardKey: "db_lateral_raise" },
  { name: "Seated Leg Curl",                    setType: "standard",  rounds: 3, standardKey: "leg_curl" },
  { name: "Seated Leg Extension",               setType: "standard",  rounds: 3, standardKey: "leg_extension" },
  { name: "Back Extension",                     setType: "standard",  rounds: 3, standardKey: null, bodyweight: true },

  // Bilateral set type (3 rounds: work-L / work-R / rest)
  { name: "Standing Dumbbell Curl",             setType: "bilateral", rounds: 3, standardKey: "db_curl" },
  { name: "Overhead Dumbbell Triceps Extension",setType: "bilateral", rounds: 3, standardKey: "db_triceps_extension" },
  { name: "Standing Knee Raise",                setType: "bilateral", rounds: 3, standardKey: null },

  // Cardio — manual metric logging only, no timer / weight / reps
  { name: "Swimming",                           setType: "cardio_swim", category: "cardio" },
  { name: "Stationary Bike",                    setType: "cardio_bike", category: "cardio" }
];
