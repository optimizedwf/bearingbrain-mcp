export interface Guide {
  slug: string
  title: string
  description: string
  keywords: string
  readTime: string
  sections: Array<{
    heading: string
    content: string
  }>
}

export const GUIDES: Guide[] = [
  {
    slug: 'how-to-read-bearing-numbers',
    title: 'How to Read a Bearing Number',
    description:
      'Decode any bearing designation. Learn what each digit and suffix means across SKF, NSK, FAG, Timken, NTN, and KOYO.',
    keywords:
      'bearing number meaning, how to read bearing designation, bearing number decoder, SKF bearing number system, bearing suffix meaning, 6205-2RS meaning',
    readTime: '5 min',
    sections: [
      {
        heading: 'The Basic Structure',
        content: `A bearing number like **6205-2RS** contains three layers of information: the series (what type), the size (what dimensions), and the suffix (what features).

The first digit identifies the bearing type. In the ISO system used by most manufacturers:

- **6** — Deep groove ball bearing
- **7** — Angular contact ball bearing
- **N** or **NU** — Cylindrical roller bearing
- **22** — Spherical roller bearing
- **30** or **32** — Tapered roller bearing
- **12** or **11** — Self-aligning ball bearing

The second digit indicates the width series (how narrow or wide), and the last two digits encode the bore diameter. For bearings 04 and above, multiply the last two digits by 5 to get the bore in millimeters. So **6205** = deep groove ball bearing, 200 series, 25mm bore.`,
      },
      {
        heading: 'Common Bore Codes',
        content: `The bore code (last two digits) follows a simple rule for most sizes:

| Code | Bore (mm) |
|------|-----------|
| 00 | 10 |
| 01 | 12 |
| 02 | 15 |
| 03 | 17 |
| 04 | 20 |
| 05 | 25 |
| 06 | 30 |
| 10 | 50 |
| 20 | 100 |

For codes 04 and above, multiply by 5. Codes 00–03 are special cases that must be memorized.`,
      },
      {
        heading: 'Suffixes — Seals, Shields & Features',
        content: `The suffix tells you about sealing, clearance, and special features:

**Seals & Shields:**
- **2Z** or **ZZ** — Metal shields on both sides (for moderate contamination protection)
- **2RS** or **2RS1** — Rubber contact seals on both sides (for dust and moisture)
- **2RZ** — Non-contact rubber seals (lower friction than 2RS)
- No suffix — Open bearing (requires external sealing)

**Clearance:**
- **C3** — Greater than normal internal clearance (for temperature expansion)
- **C2** — Less than normal clearance (for precision)
- No suffix — Normal clearance (CN)

**Cage:**
- **M** — Brass cage
- **TN** or **P** — Polymer cage

For example, **6205-2RS1/C3** is a deep groove ball bearing, 25mm bore, with rubber seals and C3 clearance.`,
      },
      {
        heading: 'Manufacturer Differences',
        content: `While the base number is standardized (ISO 15), suffix conventions differ:

| Feature | SKF | NSK | FAG | NTN |
|---------|-----|-----|-----|-----|
| Rubber seal | 2RS1 | DDU | 2RSR | LLU |
| Metal shield | 2Z | ZZ | 2ZR | ZZ |
| C3 clearance | /C3 | C3 | .C3 | C3 |

The core designation (6205, 6308, etc.) is always the same across brands. Only the suffix notation varies. Our cross-reference tool handles these translations automatically.`,
      },
    ],
  },
  {
    slug: 'ball-bearing-vs-roller-bearing',
    title: 'Ball Bearing vs Roller Bearing: When to Use Which',
    description:
      'When to use ball bearings versus roller bearings. Covers load types, speed ratings, and application guidelines.',
    keywords:
      'ball bearing vs roller bearing, bearing type selection, when to use roller bearing, ball bearing applications, bearing load capacity comparison',
    readTime: '4 min',
    sections: [
      {
        heading: 'The Core Difference',
        content: `Ball bearings use spherical rolling elements. Roller bearings use cylindrical, tapered, spherical, or needle-shaped rollers. This fundamental difference in geometry determines everything: load capacity, speed capability, and tolerance for misalignment.

**Ball bearings** make point contact with the races. This means lower friction and higher speed capability, but less load-carrying capacity per unit of bearing size.

**Roller bearings** make line contact with the races. This distributes load over a larger area, giving significantly higher load capacity at the cost of higher friction and lower maximum speeds.`,
      },
      {
        heading: 'When to Use Ball Bearings',
        content: `Choose ball bearings when:

- **Speed is the priority.** Ball bearings handle 20–50% higher speeds than comparable roller bearings. Electric motors, fans, and pumps typically use deep groove ball bearings.
- **Loads are moderate.** For radial loads up to roughly 50% of the bearing's rated capacity, ball bearings are the most cost-effective choice.
- **You need simplicity.** Deep groove ball bearings handle both radial and axial loads in a single row, simplifying design.
- **Noise matters.** Ball bearings run quieter than roller bearings, which is important in consumer products and HVAC equipment.
- **Space is tight but loads are light.** Miniature ball bearings are available down to 1mm bore.`,
      },
      {
        heading: 'When to Use Roller Bearings',
        content: `Choose roller bearings when:

- **Heavy radial loads dominate.** Cylindrical roller bearings carry 30–50% more radial load than same-size ball bearings.
- **Combined loads are heavy.** Tapered roller bearings handle simultaneous heavy radial and axial loads, which is why they're standard in automotive wheel hubs.
- **Misalignment is unavoidable.** Spherical roller bearings accommodate up to 2° of shaft misalignment under full load — essential for mining, paper, and cement machinery.
- **Shock loads occur.** Roller bearings absorb impact loads better due to their larger contact area.
- **Space is constrained radially.** Needle roller bearings provide high load capacity with a very small radial cross-section.`,
      },
      {
        heading: 'Quick Selection Table',
        content: `| Application | Recommended Type | Why |
|------------|-----------------|-----|
| Electric motors | Deep groove ball | High speed, moderate load |
| Conveyor rollers | Deep groove ball or cylindrical roller | Depends on load |
| Automotive wheels | Tapered roller | Heavy combined loads |
| Machine tool spindles | Angular contact ball | Precision + speed |
| Mining equipment | Spherical roller | Misalignment + heavy loads |
| Gearboxes | Tapered roller or cylindrical roller | Heavy loads + axial thrust |
| Pumps | Deep groove ball | Speed + both load directions |
| Paper mills | Spherical roller | Misalignment + heavy duty |`,
      },
    ],
  },
  {
    slug: 'bearing-cross-reference-guide',
    title: 'Bearing Cross-Reference Guide',
    description:
      'How to find equivalent bearings across manufacturers. Covers exact replacements, dimensional matches, and common pitfalls.',
    keywords:
      'bearing cross reference, how to find equivalent bearing, bearing interchange, SKF NSK FAG equivalent, bearing replacement guide',
    readTime: '6 min',
    sections: [
      {
        heading: 'What Is a Cross-Reference?',
        content: `A bearing cross-reference identifies equivalent bearings from different manufacturers. Since most bearings follow ISO dimensional standards, a 6205 from SKF has the same bore (25mm), outer diameter (52mm), and width (15mm) as a 6205 from NSK, FAG, NTN, or KOYO.

There are three levels of equivalence:

- **Exact replacement** — Same dimensions, same type, same internal design. Direct drop-in substitution.
- **Dimensional match** — Same external dimensions but potentially different internal design details (cage type, clearance class, seal material).
- **Functional equivalent** — Different dimensions but serves the same function in a specific application.`,
      },
      {
        heading: 'The Standard Number System',
        content: `The ISO 15 standard means that most manufacturers use the same base designation:

| Base Number | All Manufacturers |
|-------------|------------------|
| 6205 | SKF 6205, NSK 6205, FAG 6205, NTN 6205, KOYO 6205 |
| 6308 | SKF 6308, NSK 6308, FAG 6308, NTN 6308, KOYO 6308 |
| 7206 | SKF 7206, NSK 7206, FAG 7206, NTN 7206, KOYO 7206 |

The base number is universal. What differs is the suffix convention for seals, clearance, and cage type. Timken uses a different system for some types — for example, their 200K is equivalent to a 6200 deep groove bearing.`,
      },
      {
        heading: 'Common Pitfalls',
        content: `When cross-referencing, watch for these traps:

**1. Suffix confusion.** A SKF 6205-2RS1 and NSK 6205DDU are both sealed deep groove bearings, but the seal material and contact pressure may differ slightly. For most applications this doesn't matter, but for high-speed or extreme-temperature use, check the datasheet.

**2. Load rating differences.** Even with identical dimensions, manufacturers may rate bearings differently. A SKF 6205 has a dynamic load rating of 14.8 kN; the NSK version might be rated at 14.0 kN. The physical capability is similar, but the published numbers reflect different testing methodologies.

**3. Precision grades.** Standard industrial bearings (ABEC-1) are interchangeable across brands. Precision bearings (ABEC-5, ABEC-7) should generally be replaced with the same brand or verified for tolerance compatibility.

**4. Obsolete numbers.** Some older part numbers have been superseded. Always verify the current designation with the manufacturer.`,
      },
      {
        heading: 'How to Use BearingBrain for Cross-References',
        content: `Enter any bearing part number in the search bar or chat. BearingBrain will:

1. Identify the bearing and its manufacturer
2. Look up all known equivalents from other brands
3. Show dimensional verification (bore, OD, width must match)
4. Display pricing from multiple suppliers

For brand-to-brand interchange tables, visit the Cross-Reference section where you can view complete conversion charts between any two manufacturers.`,
      },
    ],
  },
  {
    slug: 'bearing-seal-types-explained',
    title: 'Bearing Seal Types Explained: Open, 2Z, 2RS, 2RZ',
    description:
      'Open, 2Z, 2RS, 2RZ — what each seal type means, when to use it, and how it affects speed and temperature limits.',
    keywords:
      'bearing seal types, 2RS vs 2Z, bearing shield vs seal, open bearing, 2RZ bearing, bearing seal selection',
    readTime: '4 min',
    sections: [
      {
        heading: 'Why Seals Matter',
        content: `The seal or shield on a bearing serves two purposes: keeping contaminants out and keeping lubricant in. The type of seal directly affects the bearing's maximum speed, operating temperature, friction, and service life.

Choosing the wrong seal type is one of the most common causes of premature bearing failure. An open bearing in a dusty environment will fail quickly from contamination. A contact-sealed bearing in a high-speed application will overheat from friction.`,
      },
      {
        heading: 'Open Bearings (No Suffix)',
        content: `An open bearing has no seals or shields. It offers the lowest friction and highest speed capability, but provides no protection against contamination.

**Use when:**
- The bearing is in a sealed housing that provides external protection
- Maximum speed is needed (the bearing itself is the least restrictive element)
- You're using an external lubrication system (oil bath, mist, or jet)

**Avoid when:**
- Dust, moisture, or particles are present
- The bearing must retain its own grease`,
      },
      {
        heading: 'Metal Shields (2Z / ZZ)',
        content: `Metal shields are thin steel plates attached to the outer ring with a small gap to the inner ring. They're "non-contact" — the shield doesn't touch the rotating inner ring.

**Characteristics:**
- Lower friction than rubber seals
- Higher speed capability (90–95% of open bearing speed)
- Moderate contamination protection (blocks large particles, not fine dust)
- Temperature range: −30°C to +110°C (standard)

**Use when:**
- Moderate contamination is expected
- Speed is important
- The environment is relatively dry`,
      },
      {
        heading: 'Rubber Contact Seals (2RS / DDU / LLU)',
        content: `Rubber seals (typically nitrile or FKM/Viton) press against the inner ring, creating a contact seal. This provides the best contamination protection but adds friction.

**Characteristics:**
- Highest contamination protection (dust, moisture, splash water)
- Lower speed capability (70–80% of open bearing speed)
- More friction and heat generation than shields
- Standard nitrile: −30°C to +110°C; Viton: −20°C to +200°C

**Use when:**
- Dust, moisture, or washdown conditions exist
- The bearing must retain grease for its entire service life
- Relubrication is not possible or practical`,
      },
      {
        heading: 'Non-Contact Seals (2RZ)',
        content: `Non-contact rubber seals combine the sealing benefit of rubber with the low friction of shields. The rubber lip has a small gap to the inner ring instead of making contact.

**Characteristics:**
- Better contamination protection than metal shields
- Lower friction than contact seals
- Speed capability: 85–90% of open bearing speed
- Good compromise for moderate environments

**Use when:**
- You need better sealing than shields but can't accept the friction of contact seals
- Medium-speed applications with some contamination risk`,
      },
      {
        heading: 'Selection Summary',
        content: `| Seal Type | Speed | Protection | Friction | Best For |
|-----------|-------|------------|----------|----------|
| Open | Highest | None | Lowest | Sealed housings, oil lubrication |
| 2Z (Shield) | High | Moderate | Low | Dry, moderate environments |
| 2RZ (Non-contact) | Medium-High | Good | Medium | Balanced applications |
| 2RS (Contact seal) | Medium | Best | Higher | Dusty, wet, maintenance-free |`,
      },
    ],
  },
  {
    slug: 'bearing-failure-causes',
    title: 'Common Bearing Failure Causes and Prevention',
    description:
      'The top reasons bearings fail prematurely: contamination, misalignment, overloading, improper lubrication, and how to prevent each.',
    keywords:
      'bearing failure causes, why bearings fail, bearing contamination, bearing misalignment, bearing overheating, bearing maintenance',
    readTime: '5 min',
    sections: [
      {
        heading: 'Why Bearings Fail Early',
        content: `A properly selected and installed bearing should last years — often decades. When a bearing fails prematurely, the cause almost always falls into one of five categories: contamination, lubrication failure, misalignment, overloading, or improper installation.

Understanding these failure modes helps you diagnose problems and prevent recurrence. The damage pattern on the bearing's races and rolling elements tells you exactly what went wrong.`,
      },
      {
        heading: '1. Contamination (40% of Failures)',
        content: `Contamination is the leading cause of bearing failure. Particles as small as the lubricant film thickness (typically 0.2–1 μm) can cause surface damage that propagates into fatigue spalling.

**Signs:** Dull, rough raceway surfaces; abrasive wear patterns; dark discoloration of grease.

**Prevention:**
- Use sealed or shielded bearings in contaminated environments
- Keep work areas clean during installation
- Filter lubricant oil systems to ISO cleanliness codes
- Replace seals during maintenance rather than reusing them`,
      },
      {
        heading: '2. Lubrication Problems (35% of Failures)',
        content: `Both under-lubrication and over-lubrication cause failures. Under-lubrication leads to metal-to-metal contact and heat. Over-lubrication causes churning, heat buildup, and seal damage.

**Signs of under-lubrication:** Blue/brown discoloration on races from heat; dry, cracked grease.

**Signs of over-lubrication:** Grease leaking from seals; elevated temperature; excess energy consumption.

**Prevention:**
- Follow manufacturer relubrication intervals and quantities
- Use the correct grease type (base oil viscosity must match speed and load)
- For sealed bearings: they are pre-lubricated for life — do not add grease
- Monitor bearing temperature as an early warning sign`,
      },
      {
        heading: '3. Misalignment (15% of Failures)',
        content: `Angular or axial misalignment between the shaft and housing forces the bearing to operate off-center, concentrating load on a small portion of the raceway.

**Signs:** Wear patterns that are not centered on the raceway; uneven ball paths; shaft deflection marks.

**Prevention:**
- Ensure proper shaft and housing alignment during assembly
- Use self-aligning bearings (spherical roller or self-aligning ball) when alignment cannot be guaranteed
- Check mounting surfaces for flatness and perpendicularity
- Laser-align coupled shafts`,
      },
      {
        heading: '4. Overloading (5% of Failures)',
        content: `Applying loads beyond the bearing's dynamic capacity reduces fatigue life exponentially. For ball bearings, doubling the load reduces life by a factor of 8.

**Signs:** Heavy spalling on the loaded zone; plastic deformation of races; roller edge stress marks.

**Prevention:**
- Verify load calculations during design (include shock, vibration, and dynamic factors)
- Use a bearing with adequate safety margin (typically 3–5× expected load for L10 life calculations)
- Consider upgrading to a larger bearing or a different type (roller instead of ball) for heavy applications`,
      },
      {
        heading: '5. Improper Installation (5% of Failures)',
        content: `Incorrect mounting damages bearings before they ever run. Common mistakes include hammering on the wrong ring, using excessive press force, or mounting bearings on damaged shafts.

**Signs:** Brinelling (dents from rolling elements); cracked rings; axial marks on bore or OD from improper pressing.

**Prevention:**
- Always apply press force through the ring being fitted (bore ring for shaft mounting, outer ring for housing mounting)
- Use proper tools: induction heaters for interference fits, hydraulic nuts for large bearings
- Never strike a bearing directly with a hammer
- Inspect shaft and housing surfaces for burrs, rust, or damage before mounting`,
      },
    ],
  },
  {
    slug: 'bearing-failure-diagnosis',
    title: 'Bearing Failure Diagnosis: How to Read Damage Patterns',
    description:
      'Identify bearing failure modes from damage patterns on races, rolling elements, and cages. Covers spalling, brinelling, smearing, corrosion, electrical erosion, and cage failure with root causes and corrective actions.',
    keywords:
      'bearing failure diagnosis, bearing damage analysis, spalling bearing, brinelling bearing, bearing failure modes, bearing failure analysis, why did my bearing fail, bearing damage patterns, bearing forensics',
    readTime: '8 min',
    sections: [
      {
        heading: 'Reading the Evidence',
        content: `Every failed bearing tells a story. The damage patterns on the races, rolling elements, and cage reveal exactly what went wrong — and more importantly, what to fix so the replacement doesn't fail the same way.

Before discarding a failed bearing, examine it carefully. Note the location and appearance of damage on:

- **Inner race** — the surface the rolling elements contact on the shaft-mounted ring
- **Outer race** — the surface in the housing-mounted ring
- **Rolling elements** — balls or rollers
- **Cage** — the retainer that separates the rolling elements
- **Seal or shield** — if damaged, contamination may be the root cause

Take photographs before cleaning. The lubricant condition (color, consistency, debris) is itself diagnostic evidence.`,
      },
      {
        heading: 'Fatigue Spalling',
        content: `**Appearance:** Flaking, pitting, or crater-like removal of material from the raceway surface. Starts as small pits that grow and connect into larger flaked areas. Surface has a rough, granular texture where material has broken away.

**Location:** Typically in the loaded zone of the race. On the inner race, spalling in a circumferential band indicates normal rotating load fatigue. On the outer race, spalling concentrated in one area indicates a stationary point load.

**Root Causes:**

- **Normal fatigue** — Every bearing has a finite life. If the bearing ran for its calculated L10 life or longer, this is expected end-of-life failure.
- **Overloading** — Loads exceeding the bearing's rated capacity accelerate fatigue. For ball bearings, doubling the load reduces life by a factor of 8.
- **Insufficient internal clearance** — Thermal expansion of the shaft and housing can eliminate clearance, creating excessive preload and concentrated stress.
- **Poor lubrication** — Inadequate film thickness increases metal-to-metal contact stress.

**Corrective Actions:**

- Verify actual loads against bearing rated capacity
- Check that the bearing selection provides adequate L10 life for the application (target at least 20,000 hours for general industrial use)
- Review fit and clearance — ensure the bearing has appropriate internal clearance for the operating temperature range
- Verify lubrication type and quantity`,
      },
      {
        heading: 'True Brinelling',
        content: `**Appearance:** Permanent dents or indentations in the raceway at rolling element spacing. Each dent corresponds exactly to the position of a ball or roller. The surface within the dent is smooth and shiny, with clearly defined edges.

**Location:** On both inner and outer races, spaced evenly to match the number of rolling elements.

**Root Causes:**

- **Static overload** — Excessive force applied while the bearing is stationary, such as pressing the bearing onto a shaft through the wrong ring
- **Shock loads** — Impact loading from being dropped, hammered during installation, or subjected to machinery collisions
- **Transportation damage** — Vibration during shipping of assembled equipment with bearings under preload

**Corrective Actions:**

- Never apply installation force through the rolling elements — press only on the ring being fitted
- Use proper installation tools (induction heaters, hydraulic press, installation sleeves)
- Block shafts during transport to prevent bearing load
- Verify static safety factor S0 is adequate (minimum 1.0 for normal, 1.5 for vibration, 2.0 for precision applications)`,
      },
      {
        heading: 'False Brinelling',
        content: `**Appearance:** Shallow depressions or wear marks in the raceway at rolling element positions, similar to true brinelling but with a dull, matte, or oxidized appearance. The worn areas may have a reddish-brown color from fretting corrosion.

**Location:** On the loaded zone of the non-rotating race. Common in bearings that vibrate while stationary.

**Root Causes:**

- **Vibration while stationary** — Equipment that vibrates during transport or when shut down (e.g., electric motors on standby, railway axle bearings in parked trains)
- **Small oscillations** — Pivoting or rocking motion that doesn't allow the rolling elements to complete a full revolution, preventing lubricant replenishment

**Corrective Actions:**

- Isolate non-running equipment from vibration sources
- Rotate shafts periodically during extended shutdown
- Use lubricants with anti-wear (EP) additives
- Consider bearing types designed for oscillating loads`,
      },
      {
        heading: 'Smearing and Skidding',
        content: `**Appearance:** Streaked, smeared, or dragged areas on the raceway surface. The damaged areas have a torn or welded appearance with material displacement in the direction of sliding. Surface may appear rough and discolored.

**Location:** Commonly on the inner race of cylindrical roller bearings or on the roller ends and guide flanges.

**Root Causes:**

- **Insufficient load** — When a bearing is too lightly loaded for its speed, rolling elements can skid instead of roll. The momentary sliding causes instantaneous welding and tearing of surface material.
- **Sudden acceleration or deceleration** — Rapid speed changes cause rollers to slide before achieving rolling contact.
- **Inadequate lubrication** — Insufficient lubricant film allows metal-to-metal sliding contact.

**Corrective Actions:**

- Ensure minimum load is met (especially for cylindrical roller and angular contact bearings — SKF recommends minimum load of 0.02C for roller bearings)
- Apply preload to angular contact or tapered roller bearings
- Use a lighter lubricant to reduce viscous drag
- Apply load gradually during startup`,
      },
      {
        heading: 'Corrosion and Moisture Damage',
        content: `**Appearance:** Rust or dark oxidation on raceway surfaces. In advanced cases, pitting that follows the rolling element contact pattern. Etching or dark stains on polished surfaces. Lubricant may appear milky or emulsified.

**Location:** Often uniform across the raceway in static bearings, or in the loaded zone pattern in rotating bearings where moisture enters past seals.

**Root Causes:**

- **Water ingress** — Washdown environments, condensation from temperature cycling, leaking seals
- **Chemical exposure** — Acids, alkalis, or process fluids contaminating the bearing
- **Improper storage** — Bearings stored in humid environments without protective coating
- **Galvanic corrosion** — Dissimilar metals in contact in the presence of moisture

**Corrective Actions:**

- Upgrade to sealed bearings (2RS) in wet environments
- Use stainless steel bearings (AISI 440C or X65Cr13) for washdown applications
- Store bearings in original packaging until installation
- Apply preservation coating to spare bearings
- Use moisture-resistant lubricants (calcium sulfonate greases)
- Verify seal condition during maintenance intervals`,
      },
      {
        heading: 'Electrical Erosion (Fluting)',
        content: `**Appearance:** A pattern of parallel grooves or ridges across the raceway, spaced at regular intervals. Under magnification, the surface shows pitting from electrical discharge craters. In early stages, the raceway has a frosted or gray appearance.

**Location:** On both races, typically across the full width of the raceway. The pattern is remarkably uniform and evenly spaced — this regularity distinguishes electrical damage from mechanical causes.

**Root Causes:**

- **Stray currents** — Current passing through the bearing from the motor shaft to ground via the housing. Common with variable frequency drives (VFDs) that generate common-mode voltage.
- **Static discharge** — Belt-driven equipment or processes generating static electricity.
- **Welding current** — Ground current from welding operations passing through nearby bearings.

**Corrective Actions:**

- Install shaft grounding brushes or grounding rings on VFD-driven motors
- Use insulated bearings (ceramic-coated outer ring or hybrid bearings with ceramic rolling elements)
- Ensure proper motor grounding
- Route welding ground cables to avoid current paths through bearings
- Use conductive grease if shaft grounding is not practical`,
      },
      {
        heading: 'Cage Failure',
        content: `**Appearance:** Cracked, broken, or deformed cage. Cage pockets may be worn or enlarged. Metal cages may show fatigue cracks. Polymer cages may show melting, discoloration, or embrittlement.

**Location:** Examine the cage for cracks at the bridges between pockets and for wear on the guiding surfaces (bore or OD depending on cage design).

**Root Causes:**

- **Vibration and shock** — Excessive vibration causes cage fatigue, especially in pressed steel cages
- **High acceleration** — Rapid speed changes stress the cage as rolling elements shift in their pockets
- **Contamination** — Particles jamming between cage and rolling elements
- **Inadequate lubrication** — The cage is the last component to receive lubricant and the first to suffer from starvation
- **Excessive temperature** — Polymer cages (nylon/polyamide) degrade above 120 degrees C; brass cages are more temperature-resistant

**Corrective Actions:**

- Use brass or machined cages for high-vibration or high-temperature applications
- Ensure adequate lubrication reaches the cage
- Review bearing clearance and preload settings
- Consider a bearing with a different cage design for the application`,
      },
      {
        heading: 'Misalignment Damage',
        content: `**Appearance:** Wear path on the raceway that is not parallel to the race edges. On ball bearings, the ball track appears tilted or wider on one side. On roller bearings, one end of the roller shows heavier wear than the other.

**Location:** Inner and outer races show opposing tilt patterns. Rollers may show tapered wear or edge loading marks.

**Root Causes:**

- **Shaft deflection** — Undersized shaft bending under load
- **Housing bore misalignment** — Housing bores not concentric or not perpendicular to the mounting surface
- **Mounting errors** — Cocked bearing on the shaft or in the housing
- **Foundation settling** — Equipment base shifting over time

**Corrective Actions:**

- Check and correct shaft and housing alignment (laser alignment for coupled shafts)
- Verify mounting surface flatness and perpendicularity
- Use self-aligning bearings (spherical roller or self-aligning ball) where alignment cannot be guaranteed
- Review shaft stiffness and add support if deflection is excessive
- SKF recommends that misalignment not exceed 2 to 4 minutes of arc for cylindrical roller bearings, or 0.5 degrees for self-aligning types`,
      },
      {
        heading: 'Diagnostic Flowchart',
        content: `Use this systematic approach when examining a failed bearing:

**1. Examine the lubricant first.**
- Dark, burnt, or dry lubricant points to lubrication failure or overheating.
- Milky or emulsified lubricant indicates water contamination.
- Metal particles in the lubricant suggest advanced wear was occurring before failure.
- Clean, adequate lubricant with sudden failure suggests overload or installation damage.

**2. Check the damage location on the race.**
- Circumferential band on inner race with localized patch on outer race is normal rotating inner ring fatigue pattern.
- Localized damage on inner race with circumferential band on outer race indicates rotating outer ring (less common).
- Damage evenly spaced at ball pitch suggests brinelling (static overload or vibration).
- Uniform grooves across the full raceway suggest electrical erosion.

**3. Examine the rolling elements.**
- Spalled or pitted balls/rollers confirm fatigue damage.
- Flat spots or skid marks suggest insufficient load or sudden speed changes.
- Discoloration indicates overheating.
- Uniform wear suggests contamination.

**4. Check the cage.**
- Broken cage with otherwise clean races suggests vibration or acceleration damage.
- Worn cage pockets with contaminated lubricant suggests particle ingestion.
- Melted or discolored polymer cage indicates excessive temperature.

For complex failure analysis or recurring failures, professional bearing forensics can identify root causes that visual inspection may miss. Bearing Consultants (bearingconsultants.com) provides detailed failure analysis services.`,
      },
    ],
  },
]

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug)
}
