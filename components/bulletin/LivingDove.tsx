"use client";

import { cx } from "@/lib/utils";

/**
 * The living dove — the brand's 35-silhouette mosaic mark, animated in CSS.
 *
 * Distilled from the interactive showcase page's `#doveMosaicGroup`: the same 35
 * interlocking silhouettes (wings, body, head, tail, and the hidden hearts),
 * each carrying its `data-part`, drawn in the brand dove green. The page around
 * the group — navbar, toolbar, inspector, directory, embed modal, and the
 * requestAnimationFrame physics loop — is deliberately **not** ported: the
 * motion here is CSS only (`.dw-dove-*` in `app/globals.css`), so the mark costs
 * no JavaScript and cannot jank while the reader scrolls the rail.
 *
 * Motion, all CSS:
 *  - breathing: a slow `translateY` keyframe on the single `<g>` that wraps
 *    every path, so it never fights the per-path hover transform;
 *  - hover: the silhouette under the cursor darkens toward the brand deep green
 *    and scales slightly, through plain `:hover`.
 *
 * Decorative by contract: `aria-hidden`, no title, no focus target, no click
 * behaviour. It is no longer the bulletin reader's empty state (that surface
 * shows the canonical empty bowl) and nothing renders it today — it stays in
 * the codebase as the standalone animated mark.
 */

type DovePart = "wing" | "body" | "head" | "tail" | "heart";

interface DovePiece {
  /** Which anatomical slice of the bird this silhouette belongs to. */
  part: DovePart;
  /** The path geometry, verbatim from the showcase's mosaic group. */
  d: string;
}

/** The 35 silhouettes of the DoveLewis mosaic, in the order the source draws them. */
const DOVE_PIECES: readonly DovePiece[] = [
  { part: "wing", d: "M 294,4 C 308,10 318,22 322,32 C 314,38 308,42 303,44 C 299,28 296,14 294,4 Z" },
  { part: "wing", d: "M 263,29 C 268,25 275,27 279,32 C 283,24 287,16 290,11 C 298,25 301,40 295,55 C 286,68 286,88 286,105 C 276,108 265,103 255,96 C 258,90 264,86 266,81 C 260,78 254,73 256,66 C 262,64 268,64 270,58 C 262,53 256,46 259,39 C 265,39 271,42 273,36 C 268,34 263,32 263,29 Z" },
  { part: "heart", d: "M 294,58 C 299,58 305,68 307,75 C 301,80 293,81 289,76 C 289,68 291,60 294,58 Z" },
  { part: "wing", d: "M 314,42 C 324,38 330,48 334,56 C 344,68 352,82 351,98 C 362,102 365,112 356,118 C 342,115 325,105 314,92 C 316,84 316,74 310,66 C 304,58 308,46 314,42 Z" },
  { part: "wing", d: "M 254,113 C 264,108 272,115 276,122 C 268,128 258,126 254,113 Z" },
  { part: "heart", d: "M 288,108 C 298,104 306,114 301,123 C 292,120 286,114 288,108 Z" },
  { part: "wing", d: "M 263,137 C 272,132 282,138 289,144 C 294,134 299,126 306,128 C 309,138 316,148 326,154 C 334,158 340,148 347,152 C 350,162 342,174 331,182 C 316,192 298,200 284,196 C 280,188 286,178 278,174 C 270,174 265,166 272,160 C 276,154 266,146 263,137 Z" },
  { part: "wing", d: "M 314,100 C 332,106 348,118 364,126 C 369,116 373,104 380,106 C 378,118 375,130 374,140 C 384,142 396,138 402,144 C 392,152 380,156 372,162 C 378,170 384,178 376,184 C 364,178 354,166 346,154 C 338,142 320,136 310,124 C 318,120 328,122 332,116 C 324,110 314,106 314,100 Z" },
  { part: "wing", d: "M 301,208 C 314,200 328,194 338,198 C 336,208 338,220 344,230 C 356,246 370,260 380,278 C 386,268 396,268 398,278 C 396,292 396,304 386,306 C 368,292 348,278 332,260 C 322,248 318,232 302,228 C 298,222 308,216 301,208 Z" },
  { part: "wing", d: "M 348,176 C 362,176 372,190 384,196 C 398,202 410,214 408,230 C 406,244 404,260 416,270 C 414,278 404,276 400,268 C 394,256 396,240 386,232 C 380,242 372,248 366,242 C 368,232 374,222 366,216 C 358,216 350,224 346,216 C 348,204 342,188 348,176 Z" },
  { part: "wing", d: "M 392,158 C 408,162 422,174 432,188 C 440,200 446,214 438,228 C 430,238 428,252 418,254 C 414,242 418,226 414,212 C 408,198 394,190 388,178 C 394,174 404,178 406,172 C 398,166 390,162 392,158 Z" },
  { part: "heart", d: "M 386,294 C 392,288 402,282 406,290 C 410,300 410,314 402,320 C 392,316 382,304 386,294 Z" },
  { part: "body", d: "M 426,238 C 434,244 442,238 448,242 C 448,258 450,276 446,292 C 444,308 450,322 460,316 C 464,306 462,294 468,292 C 470,306 466,324 454,332 C 438,336 420,334 404,328 C 410,318 416,306 420,290 C 424,272 422,254 426,238 Z" },
  { part: "body", d: "M 448,196 C 464,198 480,208 492,220 C 502,230 512,240 516,252 C 508,258 498,250 490,246 C 480,242 468,248 458,242 C 448,232 448,212 448,196 Z" },
  { part: "body", d: "M 476,248 C 490,248 502,258 498,272 C 494,288 492,306 496,322 C 492,332 480,338 476,348 C 470,356 458,354 456,344 C 464,334 472,320 468,304 C 464,288 472,266 476,248 Z" },
  { part: "heart", d: "M 642,146 C 650,142 658,150 658,158 C 664,158 668,166 662,172 C 652,174 640,174 636,166 C 636,158 644,154 642,146 Z" },
  { part: "head", d: "M 668,154 C 678,158 686,166 686,176 C 678,188 670,200 668,214 C 662,226 654,238 644,244 C 640,238 648,228 650,218 C 652,206 644,194 650,186 C 658,184 666,178 666,168 C 662,162 664,156 668,154 Z" },
  { part: "head", d: "M 684,186 C 696,194 704,208 712,222 C 698,218 686,214 678,208 C 680,200 688,196 684,186 Z" },
  { part: "head", d: "M 622,176 C 630,176 636,188 640,196 C 644,212 638,228 630,242 C 622,256 616,272 602,276 C 594,268 594,254 598,242 C 604,228 614,214 610,198 C 614,192 622,198 622,188 C 618,182 618,176 622,176 Z" },
  { part: "heart", d: "M 594,198 C 602,196 606,208 602,216 C 596,222 586,224 584,216 C 586,208 590,202 594,198 Z" },
  { part: "heart", d: "M 636,250 C 644,248 652,258 648,266 C 644,274 638,282 632,278 C 628,270 622,262 628,256 C 634,256 636,252 636,250 Z" },
  { part: "body", d: "M 564,220 C 574,220 578,234 576,244 C 584,252 590,264 590,278 C 592,290 598,302 590,310 C 578,308 574,292 566,282 C 556,270 538,264 526,252 C 534,244 548,244 554,234 C 558,228 558,220 564,220 Z" },
  { part: "body", d: "M 504,274 C 516,274 524,286 534,292 C 550,298 566,306 574,322 C 570,332 556,332 546,334 C 552,342 562,348 558,356 C 546,354 536,342 524,338 C 512,334 498,334 500,320 C 504,312 516,312 516,302 C 510,292 500,284 504,274 Z" },
  { part: "body", d: "M 618,284 C 628,282 638,290 632,302 C 626,318 622,336 614,352 C 606,366 594,378 580,374 C 576,364 588,356 592,346 C 596,332 594,316 604,304 C 610,296 612,286 618,284 Z" },
  { part: "heart", d: "M 578,314 C 586,314 594,322 590,330 C 584,336 574,334 574,324 C 574,320 576,316 578,314 Z" },
  { part: "body", d: "M 508,342 C 522,340 534,352 542,362 C 538,374 526,382 516,386 C 512,378 518,368 510,362 C 504,362 500,370 496,364 C 496,354 502,344 508,342 Z" },
  { part: "heart", d: "M 562,342 C 572,340 582,350 576,360 C 568,364 558,356 562,342 Z" },
  { part: "body", d: "M 548,372 C 568,372 588,376 606,382 C 602,394 590,400 578,402 C 566,404 556,412 566,420 C 560,428 546,422 538,414 C 524,412 508,424 496,420 C 508,408 524,398 536,384 C 540,378 542,372 548,372 Z" },
  { part: "heart", d: "M 488,374 C 496,374 500,384 502,390 C 508,386 516,390 514,398 C 510,408 498,416 490,412 C 484,402 484,386 488,374 Z" },
  { part: "body", d: "M 546,420 C 556,420 562,432 554,438 C 538,446 520,452 502,456 C 496,462 492,468 486,462 C 482,454 470,456 472,446 C 480,440 492,438 504,436 C 518,434 534,432 546,420 Z" },
  { part: "tail", d: "M 468,358 C 478,358 486,368 482,380 C 476,396 472,414 462,428 C 456,438 456,452 446,456 C 438,450 442,436 436,432 C 428,432 422,424 426,416 C 434,396 446,372 468,358 Z" },
  { part: "heart", d: "M 412,426 C 420,424 424,436 420,444 C 426,450 436,452 432,460 C 422,462 412,454 410,444 C 408,436 408,428 412,426 Z" },
  { part: "tail", d: "M 398,450 C 406,450 412,460 414,468 C 414,478 404,486 394,482 C 386,476 380,466 386,458 C 392,458 396,454 398,450 Z" },
  { part: "tail", d: "M 434,458 C 442,464 450,476 446,488 C 438,506 428,524 414,538 C 406,544 404,556 396,554 C 392,546 400,536 396,530 C 390,526 396,516 402,510 C 412,498 416,480 428,468 C 432,464 432,458 434,458 Z" },
  { part: "tail", d: "M 372,472 C 380,472 384,482 390,488 C 398,492 406,498 398,506 C 390,512 386,522 386,534 C 386,544 392,554 398,548 C 402,542 406,548 402,556 C 394,564 380,564 370,562 C 362,560 350,562 354,552 C 360,544 362,532 366,520 C 370,508 364,496 366,484 C 368,478 368,472 372,472 Z" },
];

/**
 * The dove alone: a decorative SVG. Size is fixed at ~280px wide (the source
 * viewBox is 500x560, so the height follows the aspect ratio); the fill and the
 * hover/breathe motion all live in CSS.
 *
 * **No longer an empty state.** It used to be the bulletin reader's "nothing
 * selected" placeholder; that surface now shows the canonical empty bowl
 * (`components/bulletin/BulletinReaderEmptyState`). The mark itself is kept,
 * unchanged and still exported, for wherever the animated dove is wanted.
 */
export function LivingDove({ className }: { className?: string }) {
  return (
    <svg
      viewBox="240 0 500 560"
      className={cx("h-auto w-[280px] max-w-full", className)}
      aria-hidden="true"
      focusable="false"
    >
      <g className="dw-dove-breathe">
        {DOVE_PIECES.map((piece, index) => (
          <path key={index} className="dw-dove-piece" data-part={piece.part} d={piece.d} />
        ))}
      </g>
    </svg>
  );
}

export default LivingDove;
