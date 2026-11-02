# Graft workout format (import-v1)

Graft is an iPhone workout timer and log. You're writing a workout that the
user will paste into Graft. Read this whole page, then follow it for every
workout the user asks for in this chat.

## Your answer

- Answer with **exactly one JSON code block** holding the workout, in the
  format below. A sentence or two before it is fine; nothing after it.
- The JSON starts with `"importVersion": 1`.
- Two kinds of request:
  - **Converting** a workout the user gives you (text, a photo, a link):
    copy every value exactly as written. Never add a value that isn't
    there. If something can't be expressed in this format, leave it out.
  - **Creating** a workout from a description: choose sensible values.
- If the user asks for changes, answer with the whole workout again.

## How Graft thinks about a workout

- A **workout** is a list of **blocks**, in order. Each block is either a
  **workout block** or a **rest block**. A whole session (warm-up,
  strength, conditioning, cool-down) is one workout with a workout block
  for each part, and rest blocks between them where the workout says.
- A **workout block** is one **format** and a list of **exercises**, in
  order.
- A **format** says how a workout block runs. Every format has one of three
  **bases**:
  - `interval`: The clock sets the pace: a work window for each exercise, every round.
    Each window is a fixed **work** time, optionally followed by **rest**.
    **Each exercise gets its own work window, in order, and `rounds` counts
    full passes through all the exercises.** "EMOM 12, odd minutes swings,
    even minutes rowing" is 2 exercises and 6 rounds. To do several
    exercises inside the same window, put them in one superset.
  - `timed`: One running clock for the whole block; work through the list at your own pace.
    The exercises are done in order, with an optional **timeCap**. With
    `rounds`, the list is done that many times ("3 rounds for time").
    Without rounds, it repeats until the cap (AMRAP). Give `timeCap`,
    `rounds` or both.
  - `sets`: Sets of each exercise, with rest between sets.
    Each exercise has a number of **sets**, with **setRest** between sets
    (strength work).
- Each exercise in a block has a **target** (how much) and a **load** (how
  heavy).
- A **superset** is a small group of exercises, usually two or three,
  done back to back as one item: one entry in a block's exercises. In an
  interval block it shares one work window. A circuit (a list of exercises done several times) is
  not a superset: it's a `timed` block with `rounds`.
- Graft's **exercise library** gives each exercise a name, a category, and
  the target and load kinds it supports.

Graft has no notes or comments. Leave out coaching cues, tempo, "% of
1RM", "Rx" and the like.

## The format

```
{
  "importVersion": 1,
  "name": "Workout name",
  "blocks": [ Workout block or Rest block, ... ]
}
```

- `name` is optional.
- `blocks` holds at least one workout block.

**Rest block:** `{ "rest": 120 }` (seconds).

**Workout block:**

```
{
  "name": "Warm-up",
  "format": "EMOM",
  "rounds": 10,
  "exercises": [ Exercise or Superset, ... ]
}
```

- `name` is optional. Use it for parts like "Warm-up", "Strength",
  "Finisher", "Cool-down".
- `format` is a built-in format's name, or a new format (see Formats).
- The timing settings depend on the base:

  | Base | Settings | Required |
  |---|---|---|
  | `interval` | `rounds`, `work` (seconds), `rest` (seconds) | `rounds` and `work` |
  | `timed` | `timeCap` (seconds), `rounds` | `timeCap`, `rounds` or both |
  | `sets` | `setRest` (seconds), `timeCap` (seconds) | none |

  Give exactly the settings the format needs (see Formats). Leave out the
  rest.

**Exercise:**

```json
{ "exercise": "Back Squat", "sets": 5, "reps": 5, "weight": 100, "unit": "kg" }
```

- `exercise`: a built-in exercise's name, or a new exercise (see
  Exercises).
- `sets`: sets blocks only, and always there. If the workout doesn't
  say, use 1.
- **Target**, at most one of:
  - `reps`: a whole number;
  - `time`: seconds;
  - `distance`: metres;
  - `calories`: a whole number.

  No target means "as many as possible" or "until the window ends".
- **Load**, optional:
  - `weight` with `unit` (`"kg"` or `"lb"`);
  - or `band`: `"light"`, `"medium"`, `"heavy"` or `"extraHeavy"`.

  When two weights are given (like 95/65 for men and women), use the
  first. **When the workout gives no load, leave it out. Don't guess:**
  Graft fills in its own default, the same one it uses when someone adds
  that exercise by hand. Bodyweight exercises need no load.
- **Different values each round or set:** give a list instead of a
  number, one value per round (interval and timed blocks; its length must
  equal `rounds`) or per set (sets blocks; its length must equal `sets`).
  21-15-9 reps over 3 rounds is `"reps": [21, 15, 9]`. Weight can be a
  list too: `"weight": [60, 70, 80]`.

**Superset:**

```
{ "superset": [ Exercise, Exercise ], "sets": 3 }
```

- At least two exercises, each with its own target and load, and no
  `sets` of their own.
- `sets` only in sets blocks, as for an exercise.

**Write each value one way, as this page does:**

- Numbers are JSON numbers, never strings: `"reps": 15`, not
  `"reps": "15"`.
- Times (`time`, `work`, `rest`, `setRest`, `timeCap`, a rest block's
  `rest`) are seconds: `90`, not `"1:30"` or `"90s"`.
- `distance` is metres: `5000`, not `"5 km"`.
- `weight` is a number with its unit in `unit`:
  `"weight": 24, "unit": "kg"`, not `"weight": "24 kg"`.
- Keys and values are spelt exactly as on this page, in the same case:
  `timeCap`, not `time_cap`; `"extraHeavy"`, not `"extra heavy"`;
  `"strength"`, not `"Strength"`.

**Limits:** reps and calories 1–9,999; time 1–3,600 s; distance
1–1,000,000 m; weight up to 1,000 kg (2,204.5 lb); `rounds` 1–100; `sets`
1–20; `work`, `rest`, `setRest` and a rest item 1–3,600 s; `timeCap`
60–86,400 s.

## Formats

Use a built-in format only when the workout fits it exactly. Each one
needs exactly the settings listed, and fixes the others:

| Format | Base | You give | Fixed |
|---|---|---|---|
| `EMOM` | interval | `rounds` | 60 s work, no rest |
| `Tabata` | interval | `rounds` | 20 s work, 10 s rest |
| `Intervals` | interval | `rounds`, `work`, `rest` | |
| `AMRAP` | timed | `timeCap` | no rounds |
| `For Time` | timed | `timeCap`, `rounds` | |
| `Strength` | sets | `setRest` | no time cap |

**When none fits, create a format.** Name it the way the workout names it,
give its base, and give only the settings the workout states:

```
"format": { "name": "E2MOM", "base": "interval" }, "rounds": 6, "work": 120
```

Examples that need a new format: "E2MOM × 6" (120 s windows), "every 1:30
× 8", "3 rounds for time" with no time cap, "5 sets every 3 minutes", or
strength work with no rest stated.

## Exercises

Use a built-in exercise's name exactly when one fits. Each is listed with
the targets and loads it supports; an exercise in a block may only use
those.

**When none fits, create an exercise:**

```
"exercise": { "name": "Lu Raise", "category": "strength",
              "targets": ["reps"], "loads": ["weight"] }
```

- `name`: singular, like the built-ins ("Lu Raise", not "Lu Raises").
- `category`: `strength`, `power`, `core`, `cardio` or `mobility`.
- `targets`: a list of any of `reps`, `time`, `distance`, `calories`.
- `loads`: a list of any of `bodyweight`, `weight`, `band`.

If the movement isn't in the list, create it. Don't substitute a
different movement that happens to be built in.

### Built-in exercises

#### Strength

- **reps · weight:** Back Squat, Front Squat, Overhead Squat, Zercher Squat, Deadlift, Romanian Deadlift, Sumo Deadlift, Snatch-grip Deadlift, Rack Pull, Good Morning, Hip Thrust, Barbell Bench Press, Barbell Incline Bench Press, Close-grip Bench Press, Barbell Floor Press, Overhead Press, Landmine Press, Barbell Row, Pendlay Row, T-Bar Row, Shrug, Back Rack Walking Lunge, Front Rack Walking Lunge, Overhead Walking Lunge, Skull Crusher, Barbell Bicep Curl, Thruster, Lat Pulldown, Seated Cable Row, Leg Press, Leg Curl, Leg Extension, Goblet Squat, Dumbbell Front Squat, Dumbbell Romanian Deadlift, Single-leg Romanian Deadlift, Kettlebell Deadlift, Suitcase Deadlift, Kettlebell Swing, Kettlebell Clean, Dumbbell Clean, Kettlebell High Pull, Dumbbell Bench Press, Dumbbell Incline Press, Dumbbell Floor Press, Dumbbell Overhead Press, Single-arm Overhead Press, Arnold Press, Dumbbell Thruster, Dumbbell Chest Fly, Dumbbell Lateral Raise, Dumbbell Front Raise, Dumbbell Rear Delt Fly, Dumbbell Pullover, Dumbbell Bicep Curl, Hammer Curl, Dumbbell Tricep Extension, Dumbbell Row, Renegade Row, Turkish Get-up, Kettlebell Windmill, Bent Press
- **reps · weight or band:** Tricep Pushdown, Face Pull
- **reps · bodyweight or weight:** Calf Raise, Bulgarian Split Squat, Push-up, Hand-release Push-up, Diamond Push-up, Strict Handstand Push-up, Kipping Handstand Push-up, Ring Row, Rope Climb, Air Squat, Pistol Squat, Shrimp Squat, Reverse Lunge, Side Lunge, Step-up, GHD Back Extension
- **reps, time · bodyweight or weight:** Cossack Squat
- **reps · bodyweight:** Pike Push-up, Wall Walk, Jumping Pull-up, Legless Rope Climb, Skin the Cat
- **time · bodyweight:** Handstand Hold
- **distance · bodyweight:** Handstand Walk
- **reps · bodyweight or weight or band:** Dip, Bar Dip, Ring Dip, Pull-up, Strict Pull-up, Kipping Pull-up, Butterfly Pull-up, Chin-up, Chest-to-bar Pull-up, Bar Muscle-up, Ring Muscle-up
- **time · bodyweight or weight:** Dead Hang, Ring Support Hold, Wall Sit
- **reps, distance · bodyweight or weight:** Walking Lunge
- **reps, time · bodyweight or weight or band:** Glute Bridge
- **reps · bodyweight or band:** Nordic Hamstring Curl

#### Power

- **reps · weight:** Power Clean, Squat Clean, Hang Power Clean, Hang Squat Clean, High Hang Power Clean, High Hang Squat Clean, Power Clean from Blocks, Clean Pull, Clean High Pull, Muscle Clean, Power Snatch, Squat Snatch, Hang Power Snatch, Hang Squat Snatch, High Hang Power Snatch, Power Snatch from Blocks, Snatch Pull, Snatch High Pull, Muscle Snatch, Snatch Balance, Sotts Press, Push Press, Push Jerk, Split Jerk, Jerk Balance, Behind the Neck Jerk, Clean & Jerk, Power Clean & Jerk, Clean & Push Jerk, Sumo Deadlift High Pull, Dumbbell Snatch, Kettlebell Snatch, Dumbbell Clean & Jerk, Dumbbell Push Press, Devil's Press, Ball Slam, Wall Ball, Medicine Ball Clean, Sandbag Clean, Sandbag Over Shoulder, D-Ball Over Shoulder, Atlas Stone Load
- **reps · bodyweight:** Box Jump, Box Jump Over, Lateral Box Jump, Single-leg Box Jump, Depth Jump, Lateral Bound, Tuck Jump, Jump Lunge, Plyo Push-up, Burpee, Burpee Box Jump, Burpee Box Jump Over, Bar-facing Burpee, Burpee Pull-up
- **reps · bodyweight or weight:** Box Step-over, Jump Squat
- **reps, distance · bodyweight:** Broad Jump, Bounding, Burpee Broad Jump
- **reps, distance · weight:** Sandbag Lunge, Tyre Flip

#### Cardio

- **time, distance · bodyweight:** Run, Sprint, Incline Walk, Swim, Bear Crawl
- **reps, time, distance · bodyweight:** Shuttle Run
- **time, distance · weight:** Ruck, Farmer's Carry, Suitcase Carry, Front Rack Carry, Overhead Carry, Sandbag Carry, Yoke Carry, Sled Push, Sled Pull, Sled Drag
- **time, distance, calories · bodyweight:** Row, SkiErg, BikeErg, Assault Bike, Echo Bike, Air Runner
- **time, calories · bodyweight:** Stair Climber
- **reps, time · bodyweight:** Jump Rope, Single Under, Double Under, Crossover, Triple Under, Battle Rope, Jumping Jack

#### Core

- **reps · bodyweight:** Toes-to-bar, Knees-to-elbows, V-up, Tuck-up, Ab Wheel Rollout, Windshield Wiper, Reverse Crunch, Lying Leg Raise
- **reps · bodyweight or weight:** Hanging Leg Raise, Sit-up, GHD Sit-up, Russian Twist, Crunch
- **time · bodyweight:** L-sit, Arch Hold, Copenhagen Plank
- **time · bodyweight or weight:** Plank, Side Plank, Hollow Hold
- **reps, time · bodyweight or weight:** Dead Bug, Hollow Rock
- **reps, time · bodyweight:** Bird Dog, Flutter Kick, Bicycle Crunch, Plank Shoulder Tap, Plank Up-down, Mountain Climber, Dragon Flag
- **reps, time · weight or band:** Pallof Press
- **reps · weight:** Landmine Rotation

#### Mobility

- **reps · bodyweight:** Leg Swing, Squat to Stand
- **reps, time · bodyweight:** Arm Circle, Inchworm, World's Greatest Stretch, 90/90 Hip Switch, Knee-to-wall Ankle Rock, Cat-Cow, Open Book Rotation, Quadruped Wrist Rock, Thread the Needle
- **reps, distance · bodyweight:** Walking Knee Hug, Walking Quad Stretch, Walking Straight-leg Kick, Spiderman Lunge
- **time, distance · bodyweight:** A-Skip, High Knee
- **reps · band:** Band Pull-apart
- **reps · bodyweight or band:** Shoulder Pass-through, Wall Slide, Scapular Pull-up
- **time · bodyweight:** Barbell Front Rack Stretch, Couch Stretch, Pigeon Pose, Supine Twist, Child's Pose, Seated Forward Fold, Seated Straddle Fold, Wall Calf Stretch
- **time · bodyweight or weight:** Overhead Squat Hold, Deep Squat Hold, Bar Hang
- **time · band:** Banded Lat Stretch, Banded Ankle Distraction, Supine Banded Hamstring Stretch
- **time · bodyweight or band:** Half-kneeling Hip Flexor Stretch
- **reps · bodyweight or weight:** Jefferson Curl

## Examples

**"EMOM 12: odd, 15 kettlebell swings at 24 kg; even, 12 calorie row"**

```json
{
  "importVersion": 1,
  "blocks": [
    { "format": "EMOM", "rounds": 6, "exercises": [
      { "exercise": "Kettlebell Swing", "reps": 15, "weight": 24, "unit": "kg" },
      { "exercise": "Row", "calories": 12 }
    ] }
  ]
}
```

**"E2MOM × 6: 3 power cleans at 70 kg + 6 burpees", then "Fran" (21-15-9
thrusters at 95/65 lb and pull-ups, 10 minute cap)**

```json
{
  "importVersion": 1,
  "name": "Cleans and Fran",
  "blocks": [
    { "name": "Cleans", "format": { "name": "E2MOM", "base": "interval" },
      "rounds": 6, "work": 120, "exercises": [
      { "superset": [
        { "exercise": "Power Clean", "reps": 3, "weight": 70, "unit": "kg" },
        { "exercise": "Burpee", "reps": 6 }
      ] }
    ] },
    { "rest": 180 },
    { "name": "Fran", "format": "For Time", "timeCap": 600, "rounds": 3, "exercises": [
      { "exercise": "Thruster", "reps": [21, 15, 9], "weight": 95, "unit": "lb" },
      { "exercise": "Strict Pull-up", "reps": [21, 15, 9] }
    ] }
  ]
}
```

**"Warm up: 5 minutes easy on the BikeErg. Then back squat 5×5 at 100 kg, 2 minutes
rest. Finish with 3 rounds of 10 Lu raises and a 30 second hollow hold."**

```json
{
  "importVersion": 1,
  "blocks": [
    { "name": "Warm-up", "format": { "name": "Warm-up", "base": "timed" }, "rounds": 1, "exercises": [
      { "exercise": "BikeErg", "time": 300 }
    ] },
    { "name": "Strength", "format": "Strength", "setRest": 120, "exercises": [
      { "exercise": "Back Squat", "sets": 5, "reps": 5, "weight": 100, "unit": "kg" }
    ] },
    { "name": "Finisher", "format": { "name": "3 Rounds", "base": "timed" }, "rounds": 3, "exercises": [
      { "exercise": { "name": "Lu Raise", "category": "strength",
                      "targets": ["reps"], "loads": ["weight"] }, "reps": 10 },
      { "exercise": "Hollow Hold", "time": 30 }
    ] }
  ]
}
```
