# AutoChannel Algorithm Spec — V1
**Status:** Pre-build reference document  
**Venue:** Barking Dog, Bethesda MD (pilot)  
**Last updated:** June 2026
---
## 1. What AutoChannel Does
AutoChannel automatically determines what should be on every TV in a bar at any given moment. It pulls live game data from a sports API every 60 seconds, scores every available game using a two-component formula, and assigns the highest-scoring games to each TV screen. The goal is "set it and forget it" sports programming — the right game on the right screen without staff intervention.
V1 is a web dashboard (mobile-accessible, built on Replit) showing the Barking Dog's TV layout in real time: what is on each screen, the current score and game clock, and the ChannelScore driving each decision. V2 is direct TV control.
---
## 2. Venue Layout — Barking Dog
Two TV tiers:
- **Anchor TVs (3):** Main bar TVs, positioned behind the bar. Anchor 2 is the center screen. Anchors 1 and 3 are the outer screens. These are the primary viewing screens for the room.
- **Secondary TVs (10–12):** Scattered throughout the venue. Lower-priority assignment, filled in score order after anchors are set.
- **Diehard Screen:** One designated secondary TV (configured per venue) that holds demoted games for fans who came specifically to watch that game. Default: Secondary TV 3.
---
## 3. The ChannelScore Formula
Every game gets a ChannelScore from 0–100. Higher score = stronger claim on an anchor TV.
```
ChannelScore = (Relevance × 0.4) + (Vitality × 0.4) + ((Relevance × Vitality / 100) × 0.2)
```
The interaction term (last component) rewards games that score well on both dimensions. A game that is both locally relevant and competitively alive scores disproportionately higher than one that excels on only one dimension.
Both Relevance and Vitality are computed independently, then combined.
---
## 4. Relevance Score (0–100)
Relevance answers: *how much does this market and venue care that this game exists?*
```
Relevance = (BaseTeamScore + MarqueeBonus) × PlayoffMultiplier × SportSeasonWeight × StakesModifier
Relevance = min(Relevance, 100)  // hard cap
```
### 4.1 BaseTeamScore
A lookup table defined per venue. For Barking Dog (DC market):
| Team | Base Score |
|---|---|
| Washington Commanders | 90 |
| Washington Capitals | 85 |
| Washington Nationals | 80 |
| Washington Wizards | 70 |
| Maryland Terrapins | 65 |
| Baltimore Ravens | 55 |
| Baltimore Orioles | 50 |
| Premium national draw (Yankees, Cowboys, Lakers, etc.) | 40 |
| Big market / recognizable program (OSU, Alabama, etc.) | 35 |
| Generic non-local | 15 |
**Rule:** If either team in a game appears in this table, use that team's score. If both teams are local (rare), use the higher score. If neither team is in the table, use the generic non-local score.
### 4.2 MarqueeBonus (CFB only)
Applied when rankings are available from the API. Only one tier applies — they do not stack.
```
IF sport == "CFB":
    IF homeTeamRank <= 5 AND awayTeamRank <= 5: MarqueeBonus = 6
    ELSE IF homeTeamRank <= 10 AND awayTeamRank <= 10: MarqueeBonus = 4
    ELSE: MarqueeBonus = 0
IF rankings not available in API response: MarqueeBonus = 0 (skip for V1)
```
### 4.3 PlayoffMultiplier
Sourced from API playoff/postseason flags and round indicators.
| Context | Multiplier |
|---|---|
| Regular season | 1.0 |
| Playoffs — First Round | 1.4 |
| Playoffs — Conference Semifinals | 1.55 |
| Playoffs — Conference Finals / LCS / NLCS / ALCS | 1.75 |
| Championship / Finals / World Series / Super Bowl | 2.0 |
### 4.4 SportSeasonWeight
A time-of-year multiplier reflecting how much each sport dominates its peak window.
| Sport | Window | Weight |
|---|---|---|
| NFL | September–January | 1.3 |
| College Football | September–December | 1.1 |
| NHL Playoffs | April–June | 1.25 |
| NHL Regular Season | October–April | 1.0 |
| NBA Playoffs | April–June | 1.2 |
| NBA Regular Season | October–June | 0.9 |
| MLB Playoffs | October | 1.3 |
| MLB Regular Season | April–September | 0.85 |
| NCAA Basketball (March Madness) | March | 1.2 |
| NCAA Basketball (Regular Season) | November–March | 0.85 |
### 4.5 StakesModifier
Discounts games based on where they fall in the season. Prevents early regular season local team games from outscoring meaningful non-local games.
| Context | Modifier |
|---|---|
| Postseason (any round) | 1.0 |
| Regular season — final 20% of games | 0.95 |
| Regular season — middle 50% of games | 0.80 |
| Regular season — first 30% of games | 0.60 |
| Week 1–2 of any season / opener | 0.45 |
**Sport-specific thresholds:**
- NHL/NBA (82 games): first 30% = games 1–25, final 20% = games 66–82
- MLB (162 games): first 30% = games 1–49, final 20% = games 130–162
- NFL (18 games): first 30% = weeks 1–5, final 20% = weeks 15–18
- CFB: first 30% = weeks 1–4, final 20% = weeks 11–14
---
## 5. Vitality Score (0–100)
Vitality answers: *how alive and watchable is this specific game right now?*
```
Vitality = CompetitiveTension × OvertimeBonus
Vitality = min(Vitality, 100)  // hard cap
```
### 5.1 CompetitiveTension
```
CompetitiveTension = BaseTension × GamePhaseWeight × PointInGameMultiplier
```
**BaseTension** — sourced from live win probability (odds API):
```
BaseTension = 100 - (abs(WinProbability - 0.5) × 200)
```
Where WinProbability is expressed as 0–1 for the favorite.
- 50/50 game → BaseTension 100
- 75/25 game → BaseTension 50
- 90/10 game → BaseTension 10
**GamePhaseWeight** — computed from period/clock fields:
| Game phase | Weight |
|---|---|
| Pre-game (>30 min to start) | 0.4 |
| Pre-game (<30 min to start) | 0.6 |
| Early game (first 30% of game time) | 0.75 |
| Mid game (30–70% of game time) | 1.0 |
| Late game (70–90% of game time) | 1.3 |
| Clutch window (final 10%, within one score) | 1.6 |
| Final / game over | 0.0 |
Sport-specific clutch window definitions:
- NFL: 4th quarter, under 6 minutes
- NBA: 4th quarter, under 4 minutes
- NHL: 3rd period, under 8 minutes
- MLB: 8th inning or later
**PointInGameMultiplier** — combines game phase with score differential to reward late-game closeness and penalize early blowouts:
| Situation | Multiplier |
|---|---|
| Early game (phase <0.30), competitive | 0.6 |
| Early game, blowout developing | 0.3 |
| Mid game (phase 0.30–0.70), competitive | 1.0 |
| Mid game, blowout developing | 0.65 |
| Late game (phase >0.70), competitive | 1.35 |
| Late game, blowout | 0.4 |
| Clutch window, within one score | 1.7 |
| Clutch window, two scores back | 1.1 |
| Clutch window, blowout | 0.25 |
Sport-specific blowout thresholds:
- NFL: 17+ points
- NBA: 15+ points (4th quarter only — early NBA deficits frequently close)
- NHL: 3+ goals
- MLB: 4+ runs after the 6th inning
### 5.2 OvertimeBonus
```
IF game.status == "overtime" OR game.status == "extra_innings":
    Vitality = min(Vitality × 1.4, 100)
```
Any overtime game is competitive by definition. The bonus applies regardless of score differential.
---
## 6. Anchor TV Assignment
### 6.1 Lock List — 3-Anchor Lock
Certain games claim all three anchor TVs automatically. This is identity-based, not score-based. The ChannelScore formula is not evaluated for lock list decisions.
**Lock list (Barking Dog):**
- Washington Commanders — any game, regular season or playoff
- Any DC team (Capitals, Nationals, Wizards) in any postseason game, any round
- Liverpool FC — any game, any competition (venue-specific)
- Super Bowl — regardless of teams
**Lock list timing:**
- Activates 30 minutes before scheduled kickoff/puck drop
- Releases immediately when the game ends (final whistle/last out)
- Does not hold for post-game coverage or highlights
### 6.2 Anchor Modes
When no lock list game is active, anchors are assigned using one of three modes:
**2-1 SPLIT**
Triggered when the top-scoring game leads the second-scoring game by 15 or more points.
- Anchors 1 and 3 (outer screens): top-scoring game
- Anchor 2 (center screen): second-scoring game
Special rule: if the top-scoring game is a non-NFL sport and the second-scoring game is NFL (in-season), the assignment flips — NFL holds the outer anchors, the non-NFL game takes the center anchor. The room's default lean is football.
**1-1-1 SPLIT**
Default when no game leads by 15+ points, or when three roughly equal games are available.
- Anchor 1: Game ranked #1 by ChannelScore
- Anchor 2: Game ranked #2
- Anchor 3: Game ranked #3
**No split triggered by score alone into 3-anchor dominance.** Only the lock list produces a 3-anchor lock. A high-scoring non-lock-list game gets a 2-1 split at most.
### 6.3 Secondary TV Assignment
After anchors are assigned, secondary TVs fill in descending ChannelScore order with remaining games. If fewer games exist than secondary TVs, the top games repeat on remaining screens.
---
## 7. Anchor State Machine
Once a game is assigned to an anchor, it moves through the following states:
| State | Condition | Behavior |
|---|---|---|
| **Active** | ChannelScore ≥ 35, game live | Holds anchor. Stable. |
| **Protected** | GamePhase > 0.85 AND ChannelScore ≥ 55 | Holds anchor. Immune to switching. Game is in its final stretch and still alive. |
| **Demoted** | ChannelScore < 35 (blowout threshold) | Loses all anchor slots. Moves to diehard screen. Anchor opens for reassignment. |
| **Finished** | Game status == final | Removed from all screens. Anchor opens for reassignment. |
**Transition rules:**
- States move in one direction only: Active → Protected → Finished, or Active → Demoted → Finished
- A demoted game does not return to an anchor even if it tightens up
- Blowout demotion overrides completion protection — a game in its final stretch that crosses the blowout threshold (ChannelScore < 35) is demoted immediately, not held
---
## 8. Switching Rules
The algorithm re-scores every 60 seconds. It is conservative about acting on updated scores.
### 8.1 Anchor Stability
Once a game is assigned to an anchor, it holds that anchor until a natural switching moment occurs. The algorithm does not reshuffle existing assignments when scores change between refresh cycles. New scores inform what fills vacant anchors — they do not move games between screens.
### 8.2 Natural Switching Moments
The only moments when anchor assignments can change:
- A game on that anchor finishes (state: Finished)
- A game on that anchor is demoted (state: Demoted, ChannelScore drops below 35)
- A lock list game starts (overrides all current assignments)
- A manual override is applied by staff
### 8.3 Hysteresis
At a natural switching moment, a new game must outscore the game it is replacing by at least 15 points to take the anchor. Prevents marginal score differences from causing unnecessary switches.
```
IF newGame.ChannelScore - currentGame.ChannelScore >= 15: switch
ELSE: hold current game
```
### 8.4 Game Completion Protection
A game in its final stretch holds its anchor through the finish, even if higher-scoring games are starting.
```
IF game.phase > 0.85 AND game.ChannelScore >= 55:
    → Hold anchor until game ends
    → Exception: lock list game starting overrides protection
```
This prevents the algorithm from abandoning a competitive late-game moment because a new game is kicking off.
### 8.5 Blowout Demotion
When a game's ChannelScore drops below 35, it is demoted from all anchor slots to the diehard screen.
```
IF game.ChannelScore < 35:
    → Remove from all anchor slots
    → Assign to diehard screen (one secondary TV only)
    → Open vacated anchors for next best available games
```
Blowout demotion overrides game completion protection. A 4th quarter blowout does not hold an anchor because it is late in the game.
### 8.6 Manual Override
When a staff member manually changes a TV, that screen is locked for 30 minutes. The algorithm does not touch it during the lock window. After 30 minutes, the screen returns to algorithm control.
```
manualOverrideLockDuration: 1800 seconds (30 minutes)
```
---
## 9. Venue Configuration
Each venue has a configuration profile. The algorithm is the same everywhere — config makes it local.
```json
{
  "venueId": "barking-dog-bethesda",
  "venueName": "Barking Dog",
  "market": "Washington DC",
  "anchorTVs": [
    { "id": "anchor_1", "position": "left" },
    { "id": "anchor_2", "position": "center" },
    { "id": "anchor_3", "position": "right" }
  ],
  "secondaryTVs": [
    { "id": "secondary_1" },
    { "id": "secondary_2" },
    { "id": "secondary_3", "isDiehardScreen": true },
    ...
  ],
  "lockListTeams": [
    "Washington Commanders",
    "Washington Capitals",
    "Washington Nationals",
    "Washington Wizards",
    "Liverpool FC"
  ],
  "lockListEvents": [
    "Super Bowl"
  ],
  "dcPlayoffAutoLock": true,
  "teamRelevanceTable": {
    "Washington Commanders": 90,
    "Washington Capitals": 85,
    "Washington Nationals": 80,
    "Washington Wizards": 70,
    "Maryland Terrapins": 65,
    "Baltimore Ravens": 55,
    "Baltimore Orioles": 50
  },
  "thresholds": {
    "dominanceGap": 15,
    "blowoutDemotion": 35,
    "completionProtectionMinScore": 55,
    "completionProtectionPhase": 0.85,
    "manualOverrideLockSeconds": 1800
  }
}
```
---
## 10. Data Requirements
### 10.1 Required API Fields Per Game
| Field | Used For |
|---|---|
| `sport` | SportSeasonWeight lookup, blowout threshold |
| `homeTeam`, `awayTeam` | BaseTeamScore lookup |
| `homeTeamRank`, `awayTeamRank` | MarqueeBonus (CFB, if available) |
| `isPlayoff` / `postseason` | PlayoffMultiplier |
| `playoffRound` | PlayoffMultiplier tier |
| `gameNumber`, `totalGames` | StakesModifier |
| `gameStatus` | Active / halftime / final / overtime |
| `gameClock`, `period` | GamePhaseWeight, PointInGameMultiplier |
| `homeScore`, `awayScore` | Score differential, blowout detection |
| `winProbability` | BaseTension |
| `scheduledStartTime` | Pre-game phase, lock list activation |
### 10.2 Refresh Cycle
API called every 60 seconds. Scores recalculated on every cycle. Anchor assignments updated only at natural switching moments.
### 10.3 Recommended APIs for V1
- **The Odds API** — live win probabilities, game status
- **ESPN public endpoints** — scores, game clock, period, team data
- Upgrade path for V2: SportRadar or Stats Perform for deeper play-by-play and ranking data
---
## 11. Dashboard Display (V1)
Each TV slot on the dashboard shows:
- TV identifier (Anchor 1, Secondary 3, etc.)
- Game currently assigned
- Live score and game clock
- ChannelScore (visible in V1 for tuning — hidden in production)
- Current anchor state (Active / Protected / Demoted)
The ChannelScore display is a debug tool for the pilot period. It lets the operator see why Andre made a call and flag bad decisions for threshold tuning.
---
## 12. Scored Examples — DC Market Reference
Scored at mid-game, 60/40 win probability, for calibration reference:
| Game | Relevance | Vitality | ChannelScore |
|---|---|---|---|
| Maryland/Indiana hoops, unranked, mid-season | 23 | 80 | 45 |
| Ohio State vs Michigan State, CFB, mid-season | 31 | 80 | 49 |
| LSU vs Georgia, CFB, mid-season, top-10 both | 44 | 80 | 57 |
| NLDS Game 1, non-local teams | 64 | 80 | 68 |
| ALDS Game 4, elimination game, Yankees | 81 | 80 | 77 |
| Wizards Playoff Game 2 (DC team, postseason) | 100 | 80 | 88 → 3-Anchor Lock |
---
## 13. Open Items for V2
- Play-by-play momentum signals (scoring streaks, recent big plays) — requires premium API tier
- Automated TV control integration
- Multi-venue dashboard
- Operator mobile app for manual override
- Machine learning weight tuning based on operator feedback over time
---
*This document represents the complete V1 algorithm as designed. All thresholds are tunable per venue. The formula is fixed; the config is the variable.*

---
## 17. Phase 3 — Multi-market + Variable TV Count
**Precedence:** Where this section conflicts with Sections 1–13, Section 17 wins. (There are no Sections 14–16. The number was set by the Phase 3 brief.)

### 17.A Prerequisite fixes
1. **Lock list runs before scoring.** A lock-list game claims anchors and saturation by identity, never by ChannelScore. Lock games are never demoted by ChannelScore. They release only when the game ends.
2. **Saturation formula** (replaces §6 saturation):
   ```javascript
   const eligible = secondaries.filter(t => t.saturationEligible).length; // excludes diehard
   let n = Math.min(Math.round(S * sat), eligible);
   if (sat < 1.0) n = Math.min(n, Math.max(eligible - 1, 0)); // keep ≥1 secondary independent
   ```
   For Barking Dog (13 TVs / 3 anchors), a Commanders game lands on 10 TVs: 3 anchors + 7 secondaries.
3. **Multiple lock-list games live at once:** the game whose entry appears first in the lock list gets the full lock and saturation. Others are scored normally and are guaranteed at least one secondary.
4. **Diehard screen with nothing demoted:** fills by ChannelScore like any secondary. Still saturation-exempt.
5. **MLB display:** show the inning ("Top 7th") instead of a game clock.

### 17.B Market relevance template
**Setup inputs**
- `market`: dropdown from `config/markets.js` (US metros with pro teams)
- `totalTVs` N (minimum 2)
- `anchorCount` A (1 ≤ A < N). Default: `clamp(round(N × 0.25), 1, 4)`
- Secondaries S = N − A. The user marks which TVs are anchors.
- Barking Dog is a saved preset: Washington DC, 13 TVs, 3 anchors (TVs 1–3), diehard = Secondary 3.

**Base score tiers**

| Tier | Base |
|---|---|
| Home NFL | 90 |
| Home NHL | 85 |
| Home MLB | 80 |
| Home NBA | 70 |
| Home MLS | 60 |
| Home WNBA | 45 |
| Flagship college program in market | 65 |
| Secondary college program in market | 50 |
| Regional pro team (same media region, not home) | round5(home base for that sport × 0.6) |
| Premium national draw | 40 |
| Recognizable national program | 35 |
| Generic | 15 |

**Rules**
- A team's score is the max across every tier it qualifies for.
- A game uses the higher of its two teams.
- Optional per-team `adjust` (±10) for local quirks.
- Team names must exactly match the fetcher's normalized names (ESPN displayName).
- Scorer lookup order: market table → national draws → national programs → generic.

**Schema + generator**
```javascript
// config/markets.js
const MARKETS = {
  "washington-dc": {
    name: "Washington, DC",
    home: {
      NFL: ["Washington Commanders"],
      NHL: ["Washington Capitals"],
      MLB: ["Washington Nationals"],
      NBA: ["Washington Wizards"]
    },
    college: [{ name: "Maryland Terrapins", tier: "flagship" }],
    regional: [
      { name: "Baltimore Ravens", sport: "NFL" },
      { name: "Baltimore Orioles", sport: "MLB" }
    ]
  }
};

const HOME_BASE = { NFL: 90, NHL: 85, MLB: 80, NBA: 70, MLS: 60, WNBA: 45 };
const COLLEGE_BASE = { flagship: 65, secondary: 50 };
const round5 = x => Math.round(x / 5) * 5;

function buildTeamTable(m) {
  const t = {};
  const set = (name, v) => { t[name] = Math.max(t[name] ?? 0, v); };
  for (const [sport, teams] of Object.entries(m.home)) teams.forEach(n => set(n, HOME_BASE[sport]));
  m.college.forEach(c => set(c.name, COLLEGE_BASE[c.tier]));
  m.regional.forEach(r => set(r.name, round5(HOME_BASE[r.sport] * 0.6)));
  return t;
}
```

**National lists** (`config/national.js`)
- Draws (40): Yankees, Dodgers, Red Sox, Cowboys, Chiefs, Packers, 49ers, Patriots, Lakers, Celtics, Warriors
- Programs (35): Ohio State, Alabama, Michigan, Georgia, Texas, Notre Dame, LSU, Clemson

**Auto-generated lock list** (editable per venue)
- Home NFL team: `any_game`, all anchors, saturation 0.70
- Every other home pro team: `playoff_only`, all anchors, saturation 0.60
- Super Bowl and World Cup Final: saturation 1.0
- Market with no home NFL team: the highest-base home team gets the `any_game` lock at 0.70

Teams whose tier is uncertain are listed in each market's `flags` array. They are not guessed silently.

### 17.C TV scaling
**Anchor assignment (non-lock games)**
- A = 1: top-scoring game.
- A = 2: #1 and #2, one each. 2-1 split disabled.
- A ≥ 3: 1-1-1 gives the top A games. A 2-1 split (gap ≥ 15) puts the featured game on anchors 1 and A; #2, #3, etc. fill the interior anchors. NFL flip rule unchanged.
- Lock game: takes all A anchors.

**Diehard screen**
- If S ≥ 4: one designated diehard secondary (default: last secondary, user-changeable).
- If S < 4: no designated diehard. A demoted game drops to the secondary showing the lowest ChannelScore (never an anchor).

**Expected saturation results**

| N / A / S | Diehard | Commanders (0.70) | DC playoff (0.60) | Super Bowl (1.0) |
|---|---|---|---|---|
| 13 / 3 / 10 | Yes | 7 secondaries | 6 | 9 |
| 8 / 2 / 6 | Yes | 4 | 4 | 5 |
| 4 / 2 / 2 | No | 1 | 1 | 2 |
| 4 / 1 / 3 | No | 2 | 2 | 3 |

### 17.D Build notes (where 17.A–C were silent)
- **Lock list order:** events (Super Bowl, World Cup Final) come first, then `any_game` teams, then `playoff_only` teams by base score. A Super Bowl involving the home team therefore uses saturation 1.0, not 0.70. In a market with two home NFL teams, the first one listed wins if both play at once.
- **Lock window:** a lock activates 30 minutes before the scheduled start and releases at final (§6.1).
- **Super Bowl detection:** NFL + postseason + championship round, or `eventName === "Super Bowl"`. World Cup Final is matched by `eventName` only. The fetcher has no soccer feed yet.
- **Guaranteed secondary, no free TV:** if saturation 1.0 with no diehard leaves no free secondary for a second lock game, that game takes the last saturated TV.
- **Demotion needs anchor history (revised in Phase 4):** a game can be Demoted only if it held an anchor while Active (ChannelScore ≥ 35) earlier in the session. Demotion is one-way for the rest of that game. A low-scoring game that never held an anchor is not Demoted and stays anchor-eligible, so anchors don't sit empty on nights full of generic games. The highest-scoring demoted game gets the diehard screen. The history lives in the page session and resets on reload or a data-source change.
- **DC table:** D.C. United (MLS) and Washington Mystics (WNBA) are left out of `washington-dc`. That keeps it identical to the §4.1 Barking Dog table. Both are flagged.
- **Relevance floor:** under §4 a home NFL game in season keeps Relevance ≈ 94 (90 × 1.3 × 0.8). Its ChannelScore therefore can't fall below about 37, so it can't reach the 35 demotion line by blowout.
