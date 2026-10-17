# Canvas Animation Not Rendering - Bugfix Design

## Overview

The canvas animation rendering is completely non-functional. While the render loop executes correctly (evidenced by animated progress bar), no tree segments are visible. The issue stems from four interconnected problems:

1. **Double scaling** - DPR is applied twice, pushing canvas coordinates outside the visible viewport
2. **Missing curve endpoints** - The Bézier curve loop skips the final endpoint due to step size (0.02) increment
3. **Coordinate transformation order** - Canvas dimensions are scaled before proper coordinate mapping
4. **Incomplete curve paths** - Final points (x1, y1) are not explicitly drawn

The fix requires correcting the render function's coordinate transformation logic and ensuring all Bézier curve endpoints are included during drawing.

## Glossary

- **Bug_Condition (C)**: The set of conditions that trigger the rendering bug - specifically when canvas rendering occurs during animation with active segments
- **Property (P)**: The desired behavior when the bug condition occurs - tree segments are visible and properly scaled
- **Preservation**: Existing behaviors that must remain unchanged - null checks, time clamping, fallback dimensions, non-segment rendering, and DPR handling for other elements
- **renderFrame()**: The main render function in `src/rendering/canvas-renderer.ts` that orchestrates all drawing operations
- **drawSegments()**: Function in `src/rendering/canvas-renderer.ts` that draws Bézier curves for tree branches
- **render()**: Main animation loop function in `src/main.ts` that manages canvas setup, coordinate transformation, and calls renderFrame()
- **devicePixelRatio (DPR)**: The pixel ratio for high-DPI displays; values > 1 require special handling to avoid double-scaling

## Bug Details

### Bug Condition

The bug manifests when the canvas rendering system attempts to draw tree segments during animation. The system fails to display any segments despite successful data loading and an active render loop.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type {
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    geometry: TreeGeometry (with segments),
    t: number in [0, 1],
    containerRect: DOMRect
  }
  OUTPUT: boolean
  
  RETURN canvas != null
         AND ctx != null
         AND geometry.segments.length > 0
         AND t >= 0 AND t <= 1
         AND containerRect.width > 0 AND containerRect.height > 0
END FUNCTION
```

### Examples

**Example 1: Double Scaling Issue**
- Input: canvas.width = 1600 (800 × 2 DPR), canvas.height = 900 (450 × 2 DPR), ctx.scale(2, 2) applied
- Current behavior: Canvas coordinates are scaled 4× (1600 × 2 + 900 × 2), pushing all segments far outside the visible viewport
- Expected: Coordinates scaled 2× total (canvas already sized to 1600×900, scale should be 1:1 in rendering context)

**Example 2: Missing Curve Endpoints**
- Input: progress = 0.98, loop increments by 0.02: 0, 0.02, 0.04, ..., 0.96
- Current behavior: Final point p = 1.0 is never reached; last drawn point is at p = 0.96
- Expected: Loop includes all points up to and including p = 1.0, explicitly drawing final point (x1, y1)

**Example 3: Coordinate Transformation Order**
- Input: containerRect dimensions are used to set canvas.width/height before scaling
- Current behavior: canvas.width = 800, then ctx.scale(2, 2), then translate/scale for geometry
- Expected: canvas.width = 1600 (pre-multiplied by DPR), then scale in rendering context uses logical pixels only

**Example 4: Fallback Dimensions Handling**
- Input: containerRect.width = 0, containerRect.height = 0
- Current behavior: Uses fallback (800, 450), but canvas still has 0 dimensions from initial assignment
- Expected: Fallback dimensions are applied, canvas resized to fallback × DPR before rendering

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Early return when geometry is null or undefined prevents rendering attempts
- Time value t is clamped to [0, 1] range before use
- Container zero-dimension fallback (800×450) continues to work without crashes
- Leaves, flowers, and text elements render correctly after fixes
- Device pixel ratio handling for high-DPI displays remains stable

**Scope:**

All inputs that do NOT involve rendering tree segments with active animation should be completely unaffected by this fix. This includes:
- Null/undefined geometry checks
- Time clamping edge cases (t < 0 or t > 1)
- Fallback dimension activation
- Non-segment rendering (leaves, flowers, text)
- Static canvas operations (background, initialization)

**Examples of Non-Buggy Inputs:**
- When geometry is null → early return happens
- When t is outside [0, 1] → clamping preserves behavior
- When container is 0×0 → fallback triggers as before
- When rendering leaves/flowers → appearance unchanged

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Double Device Pixel Ratio Scaling**: In `main.ts` render(), the code sets `canvas.width = rect.width * DPR` and `canvas.height = rect.height * DPR`, then calls `ctx.scale(DPR, DPR)`. This causes a 4× scaling effect, pushing all coordinates outside the visible area. The canvas already accounts for DPR in its physical dimensions; the scale transform should not apply DPR again.

2. **Bézier Loop Step Size**: The loop `for (let p = 0; p <= progress; p += 0.02)` increments by 0.02 each iteration. If progress = 0.98, the loop runs 0, 0.02, ..., 0.96, then p becomes 0.98 and the loop exits without drawing the final point. The endpoint (x1, y1) is never explicitly included.

3. **Missing Final Endpoint**: Even if the loop reaches p = 1.0, there's no explicit lineTo() call at the final point (x1, y1) after the loop completes. This leaves the curve visually incomplete or disconnected.

4. **Coordinate Transformation Sequence**: The scale operation happens before translate, but the canvas dimensions have already been multiplied by DPR. The geometry coordinates are in logical pixel space; the transformation must account for this properly.

## Correctness Properties

Property 1: Bug Condition - Canvas Segments Render Correctly

_For any_ input where the bug condition holds (canvas is initialized, geometry contains segments, animation is active with 0 ≤ t ≤ 1, and container has positive dimensions), the fixed render/renderFrame functions SHALL draw visible tree segments that grow along their Bézier curves from birth time to current time, scaled correctly to the viewport without coordinate misalignment.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-Segment Rendering and Error Handling

_For any_ input where the bug condition does NOT hold (null geometry, out-of-range t values, zero container dimensions, or non-segment rendering), the fixed code SHALL produce the same result as the original code, preserving all existing error handling, time clamping, fallback behavior, and non-segment rendering.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the following changes are needed:

**File 1: `src/main.ts` - render() function**

**Changes:**
1. **Remove double DPR scaling**: Change from `ctx.scale(window.devicePixelRatio, window.devicePixelRatio)` to `ctx.scale(1, 1)` or remove it entirely
   - Rationale: Canvas.width/height are already physical pixels (multiplied by DPR); the rendering context operates in logical pixel space

2. **Preserve canvas dimension calculation**: Keep `canvas.width = rect.width * window.devicePixelRatio` and `canvas.height = rect.height * window.devicePixelRatio`
   - Rationale: This correctly sizes the canvas for high-DPI displays

3. **Adjust renderFrame parameters**: Pass the logical width/height to renderFrame() instead of physical dimensions
   - Current: `renderFrame(ctx, state.geometry, t, { width: rect.width, height: rect.height, dpr: window.devicePixelRatio, ... })`
   - Correct: Keep this as-is (logical dimensions), but ensure ctx is not double-scaled

**File 2: `src/rendering/canvas-renderer.ts` - drawSegments() function**

**Changes:**
1. **Fix Bézier curve loop to include final endpoint**: Modify the loop to explicitly include p = 1.0
   - Current: `for (let p = 0; p <= progress; p += 0.02)`
   - Fixed: `for (let p = 0; p <= progress; p += 0.02)` followed by explicit final point handling
   
   ```typescript
   // Draw curve up to progress
   for (let p = 0; p < progress; p += 0.02) {
     const px = bezier(x0, cx, x1, p);
     const py = bezier(y0, cy, y1, p);
     ctx.lineTo(px, py);
   }
   // Explicitly draw final point at progress value
   const pxFinal = bezier(x0, cx, x1, progress);
   const pyFinal = bezier(y0, cy, y1, progress);
   ctx.lineTo(pxFinal, pyFinal);
   ```

2. **Rationale**: Ensures the curve always reaches its final point (x1, y1) when progress = 1.0, eliminating missing endpoints

3. **Preserve existing scaling logic**: The lineWidth and other properties remain unchanged
   - Rationale: Prevents regression in visual appearance of segments

### Implementation Details

#### Step 1: Remove Double DPR Scaling in main.ts

Location: `src/main.ts`, render() function, after canvas.height assignment

Current code:
```typescript
canvas.width = rect.width * window.devicePixelRatio;
canvas.height = rect.height * window.devicePixelRatio;
ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
```

Fixed code:
```typescript
canvas.width = rect.width * window.devicePixelRatio;
canvas.height = rect.height * window.devicePixelRatio;
// Do NOT scale the rendering context - canvas dimensions already account for DPR
// Removing: ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
```

#### Step 2: Fix Bézier Curve Loop in canvas-renderer.ts

Location: `src/rendering/canvas-renderer.ts`, drawSegments() function, Bézier drawing loop

Current code:
```typescript
for (let p = 0; p <= progress; p += 0.02) {
  const px = bezier(x0, cx, x1, p);
  const py = bezier(y0, cy, y1, p);
  ctx.lineTo(px, py);
}
```

Fixed code:
```typescript
for (let p = 0; p < progress; p += 0.02) {
  const px = bezier(x0, cx, x1, p);
  const py = bezier(y0, cy, y1, p);
  ctx.lineTo(px, py);
}
// Explicitly draw final point to ensure complete curve
const pxFinal = bezier(x0, cx, x1, progress);
const pyFinal = bezier(y0, cy, y1, progress);
ctx.lineTo(pxFinal, pyFinal);
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that:
1. Initialize canvas and rendering context
2. Create simple geometry with one or more segments
3. Call render() or renderFrame() with animation time t in [0, 1]
4. Check if pixels are drawn to the canvas
5. Verify segment endpoints are included in the drawn path

Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Single Segment Rendering Test**: Create geometry with one vertical segment, render at t=0.5, assert that pixels are drawn in the expected viewport area (not off-screen)
2. **Curve Endpoint Test**: Render at t=1.0, verify final point (x1, y1) is included in the path (check context drawing calls)
3. **DPR Scaling Test**: With DPR=2, render canvas at 800×450 logical pixels, assert output matches 800×450 viewport (not 1600×900 or scaled incorrectly)
4. **Progressive Growth Test**: Render at t=0.25, 0.5, 0.75, 1.0 and verify segment grows smoothly without gaps

**Expected Counterexamples** (on unfixed code):
- Canvas pixels appear at very large coordinates (off-screen), confirming double scaling
- Curve path is incomplete, with endpoints missing
- Rendering never produces visible output due to coordinate misalignment

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  canvas := initialize()
  ctx := canvas.getContext('2d')
  render(ctx, input.geometry, input.t, input.rect)
  pixelsDrawn := getCanvasPixelData(canvas)
  
  ASSERT pixelsDrawn.length > 0, "Segments should be drawn"
  ASSERT allPixelsInBounds(pixelsDrawn, input.rect), "Coordinates within viewport"
  ASSERT curveEndpointIncluded(pixelsDrawn), "Final points included"
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  result_original := render_original(input)
  result_fixed := render_fixed(input)
  ASSERT result_original = result_fixed, "Behavior preserved for non-buggy inputs"
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically (null geometry, various t values, zero dimensions)
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: 
1. Observe behavior on UNFIXED code for null geometry, out-of-range t, zero container dimensions
2. Write property-based tests that verify these cases produce identical results before and after fix
3. Generate random valid inputs and verify rendering consistency

**Test Cases**:
1. **Null Geometry Preservation**: With null geometry, render() returns early without errors (same as before)
2. **Time Clamping Preservation**: With t < 0 or t > 1, values are clamped identically before and after fix
3. **Fallback Dimensions Preservation**: With zero container dimensions, fallback (800, 450) activates as before
4. **Non-Segment Rendering Preservation**: Leaves, flowers, text render with same visual properties
5. **Zero-Segment Geometry Preservation**: With empty segments array, render() completes without errors

### Unit Tests

- Test that render() correctly sets canvas dimensions including DPR multiplication
- Test that renderFrame() does not apply additional scaling to context
- Test drawSegments() with various progress values (0.0, 0.5, 1.0, 0.98, etc.)
- Test that Bézier curve endpoints are always included
- Test edge cases: single segment, many segments, zero-length segments

### Property-Based Tests

- Generate random TreeGeometry objects with varying segment counts and coordinates
- Verify segments render within viewport bounds across all generated cases
- Generate random animation times t and verify smooth growth progression
- Test with various DPR values (1, 1.5, 2, 3) to ensure scaling correctness
- Generate random container dimensions and verify proper scaling

### Integration Tests

- Load sample GitHub data and verify tree renders during full animation sequence
- Verify progress bar animates alongside segment rendering
- Test context switching (resume/pause) with segment rendering
- Verify visual consistency across multiple render cycles with same inputs

