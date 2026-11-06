"use client";

import { useId } from "react";

/**
 * Arena Cub: one rigged vector character (layered SVG). Every state animates the SAME parts with CSS
 * (frontend/components/cub/arena-cub.css), so the cub looks identical in every mood: eyes, lids, brows, ears,
 * tail, arms, head and body are separate groups with their own pivot points.
 *
 * ViewBox: x -20…260, y -50…260 (character ≈ 14…216 × 38…258; the margin is for the flying token,
 * jumps and the celebration glow).
 */
export const CUB_VIEWBOX = "-20 -50 280 310";
export const CUB_ASPECT = 310 / 280;

const FUR_STRIPE = "#2A1A12";

export function CubCharacter({ logo = "/brand/logo-mark.webp" }: { logo?: string }) {
  const raw = useId();
  const uid = raw.replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `cub-${n}-${uid}`;
  const url = (n: string) => `url(#${id(n)})`;

  return (
    <svg viewBox={CUB_VIEWBOX} className="cub-svg" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id("fur")} cx="45%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#FFC06A" />
          <stop offset="55%" stopColor="#F8871D" />
          <stop offset="100%" stopColor="#DA620B" />
        </radialGradient>
        <linearGradient id={id("furLimb")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFA94A" />
          <stop offset="100%" stopColor="#E7700F" />
        </linearGradient>
        <radialGradient id={id("cream")} cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#FFFDF7" />
          <stop offset="100%" stopColor="#F4DEC0" />
        </radialGradient>
        <radialGradient id={id("pink")} cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#FFC9D4" />
          <stop offset="100%" stopColor="#F28AA3" />
        </radialGradient>
        <radialGradient id={id("nose")} cx="40%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#FFB3C2" />
          <stop offset="100%" stopColor="#CF5C78" />
        </radialGradient>
        <radialGradient id={id("eye")} cx="50%" cy="65%" r="60%">
          <stop offset="0%" stopColor="#7A4818" />
          <stop offset="55%" stopColor="#3A1F0C" />
          <stop offset="100%" stopColor="#120904" />
        </radialGradient>
        <linearGradient id={id("hoodie")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E2550" />
          <stop offset="100%" stopColor="#0A0F25" />
        </linearGradient>
        <linearGradient id={id("sleeve")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2B3470" />
          <stop offset="100%" stopColor="#151B42" />
        </linearGradient>
        <linearGradient id={id("panel")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#5B21B6" />
        </linearGradient>
        <radialGradient id={id("gold")} cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#FFF6C4" />
          <stop offset="45%" stopColor="#FFCB45" />
          <stop offset="100%" stopColor="#D98C0B" />
        </radialGradient>
        <radialGradient id={id("goldGlow")}>
          <stop offset="0%" stopColor="#FFD86B" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#FFD86B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("bigGlow")}>
          <stop offset="0%" stopColor="#FFE08A" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#FFB020" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#FFB020" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("portal")}>
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.55" />
          <stop offset="70%" stopColor="#7C3AED" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id("tailClip")}>
          <path d="M158 230 C 188 236, 212 224, 214 198 C 216 180, 205 170, 195 176 C 190 179, 191 186, 195 190 C 199 204, 190 216, 160 218 Z" />
        </clipPath>
        <clipPath id={id("emblem")}>
          <circle cx="120" cy="192" r="11.5" />
        </clipPath>
        {/* Emerging from the portal: the rig is clipped at the floor line. */}
        <clipPath id={id("floor")}>
          <rect x="-60" y="-120" width="400" height="374" />
        </clipPath>
      </defs>

      {/* celebration glow + portal (behind everything) */}
      <circle className="cub-bigglow" cx="120" cy="150" r="125" fill={url("bigGlow")} />
      <g className="cub-portal">
        <ellipse cx="120" cy="250" rx="78" ry="14" fill={url("portal")} />
        <ellipse cx="120" cy="250" rx="66" ry="10" fill="none" stroke="#A78BFA" strokeWidth="2.6" />
        <ellipse cx="120" cy="250" rx="52" ry="7" fill="none" stroke="#22D3EE" strokeWidth="1.6" opacity="0.85" />
      </g>
      <ellipse className="cub-shadow" cx="120" cy="251" rx="60" ry="7.5" fill="#000" opacity="0.38" />

      {/* food bowl (hungry) */}
      <g className="cub-bowl">
        <ellipse cx="34" cy="246" rx="24" ry="5" fill="#000" opacity="0.3" />
        <circle cx="34" cy="226" r="14" fill={url("goldGlow")} className="cub-bowl-glow" />
        <path d="M12 230 Q34 256 56 230 Z" fill="#2E1B6B" stroke="#A78BFA" strokeWidth="1.6" />
        <ellipse cx="34" cy="230" rx="22" ry="4.5" fill="#4C1D95" stroke="#C4B5FD" strokeWidth="1" />
        <path d="M18 238 Q34 246 50 238" fill="none" stroke="#22D3EE" strokeWidth="1.2" opacity="0.8" />
        <circle cx="34" cy="227" r="5.5" fill={url("gold")} stroke="#B45309" strokeWidth="0.8" />
      </g>

      <g clipPath={url("floor")}>
        <g className="cub-rig">
          {/* tail (behind the body) */}
          <g className="cub-tail">
            <path d="M158 230 C 188 236, 212 224, 214 198 C 216 180, 205 170, 195 176 C 190 179, 191 186, 195 190 C 199 204, 190 216, 160 218 Z" fill={url("furLimb")} />
            <g clipPath={url("tailClip")} fill={FUR_STRIPE}>
              <path d="M176 214 l9 -2 l-3 14 z" />
              <path d="M193 203 l9 -6 l2 13 z" />
              <path d="M201 190 l11 -2 l-5 11 z" />
              <circle cx="199" cy="179" r="9" />
            </g>
          </g>

          <g className="cub-body">
            {/* hoodie torso */}
            <path d="M80 242 C 71 206, 78 174, 100 161 L140 161 C 162 174, 169 206, 160 242 Z" fill={url("hoodie")} />
            <path d="M80 242 C 73 210, 77 183, 92 167 C 88 190, 88 216, 95 242 Z" fill={url("panel")} opacity="0.7" />
            <path d="M160 242 C 167 210, 163 183, 148 167 C 152 190, 152 216, 145 242 Z" fill={url("panel")} opacity="0.7" />
            <path d="M92 167 C 88 190, 88 216, 95 242" fill="none" stroke="#22D3EE" strokeWidth="3.5" opacity="0.25" />
            <path d="M92 167 C 88 190, 88 216, 95 242" fill="none" stroke="#67E8F9" strokeWidth="1.3" />
            <path d="M148 167 C 152 190, 152 216, 145 242" fill="none" stroke="#A78BFA" strokeWidth="3.5" opacity="0.3" />
            <path d="M148 167 C 152 190, 152 216, 145 242" fill="none" stroke="#C4B5FD" strokeWidth="1.3" />
            {/* kangaroo pocket */}
            <path d="M98 216 Q120 210 142 216 L146 238 L94 238 Z" fill="#141A3D" stroke="#8B5CF6" strokeWidth="1.2" />
            <path d="M100 219 Q120 214 140 219" fill="none" stroke="#22D3EE" strokeWidth="0.8" opacity="0.7" />
            {/* chest emblem: the official FE Sales Arena logo */}
            <circle cx="120" cy="192" r="14.5" fill="#070B1C" stroke="#22D3EE" strokeWidth="1.4" />
            <circle cx="120" cy="192" r="16.5" fill="none" stroke="#8B5CF6" strokeWidth="0.9" opacity="0.8" />
            <image href={logo} x="108.5" y="180.5" width="23" height="23" clipPath={url("emblem")} preserveAspectRatio="xMidYMid meet" />
            {/* hood around the neck */}
            <path d="M77 170 C 72 151, 92 141, 120 143 C 148 141, 168 151, 163 170 C 150 179, 90 179, 77 170 Z" fill={url("hoodie")} stroke="#8B5CF6" strokeWidth="1.5" />
            <path d="M88 167 C 93 157, 147 157, 152 167 C 140 172, 100 172, 88 167 Z" fill="#4C1D95" />
            <path d="M80 171 C 95 180, 145 180, 160 171" fill="none" stroke="#22D3EE" strokeWidth="1" opacity="0.8" />
            {/* drawstrings */}
            <path d="M110 174 L107 190" stroke="#E5E7EB" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M130 174 L133 190" stroke="#E5E7EB" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="107" cy="191" r="1.9" fill="#22D3EE" />
            <circle cx="133" cy="191" r="1.9" fill="#A78BFA" />
          </g>

          {/* legs: thigh + foot, pivoting at the hip (sitting: soles forward with pink pads; running: they cycle) */}
          {[92, 148].map((x) => (
            <g key={x} className={`cub-leg ${x < 120 ? "cub-leg-l" : "cub-leg-r"}`}>
              <path className="cub-thigh" d={`M${x - 12} 222 Q${x} 214 ${x + 12} 222 L${x + 13} 238 L${x - 13} 238 Z`} fill={url("furLimb")} />
              <path className="cub-thigh" d={`M${x - 12} 229 l7 1 M${x + 12} 229 l-7 1`} stroke={FUR_STRIPE} strokeWidth="2" strokeLinecap="round" />
              <ellipse cx={x} cy="239" rx="22" ry="13" fill={url("furLimb")} />
              <path d={`M${x - 22} 236 q4 -6 9 -3 M${x + 22} 236 q-4 -6 -9 -3`} stroke={FUR_STRIPE} strokeWidth="2.2" fill="none" strokeLinecap="round" />
              <ellipse cx={x} cy="242" rx="15.5" ry="8.5" fill={url("cream")} />
              <ellipse cx={x} cy="245" rx="6.5" ry="4.4" fill={url("pink")} />
              <circle cx={x - 8} cy="238" r="2.5" fill={url("pink")} />
              <circle cx={x} cy="236" r="2.6" fill={url("pink")} />
              <circle cx={x + 8} cy="238" r="2.5" fill={url("pink")} />
            </g>
          ))}

          <g className="cub-head">
            {/* ears */}
            <g className="cub-ear cub-ear-l">
              <circle cx="78" cy="60" r="21" fill={url("fur")} />
              <path d="M60 52 Q66 38 82 39" fill="none" stroke={FUR_STRIPE} strokeWidth="3.4" strokeLinecap="round" />
              <ellipse cx="79" cy="63" rx="12" ry="13" fill={url("pink")} />
              <path d="M73 70 q6 -8 12 0" fill="#FFF3E3" opacity="0.9" />
            </g>
            <g className="cub-ear cub-ear-r">
              <circle cx="162" cy="60" r="21" fill={url("fur")} />
              <path d="M180 52 Q174 38 158 39" fill="none" stroke={FUR_STRIPE} strokeWidth="3.4" strokeLinecap="round" />
              <ellipse cx="161" cy="63" rx="12" ry="13" fill={url("pink")} />
              <path d="M155 70 q6 -8 12 0" fill="#FFF3E3" opacity="0.9" />
            </g>

            {/* head */}
            <path
              d="M64 108 C 58 72, 86 44, 120 44 C 154 44, 182 72, 176 108 C 184 114, 182 124, 174 126 C 166 144, 146 154, 120 154 C 94 154, 74 144, 66 126 C 58 124, 56 114, 64 108 Z"
              fill={url("fur")}
            />
            <g fill={FUR_STRIPE}>
              <path d="M120 47 C 116.5 55, 116.5 62, 120 69 C 123.5 62, 123.5 55, 120 47 Z" />
              <path d="M105 50 C 102.5 57, 105 63, 110 67 C 110 60, 109 55, 105 50 Z" />
              <path d="M135 50 C 137.5 57, 135 63, 130 67 C 130 60, 131 55, 135 50 Z" />
              <path d="M63 95 C 71 95, 78 98, 83 102 C 76 104.5, 69 103.5, 63 102 Z" />
              <path d="M65 111 C 72 110, 78 112, 81 116 C 75 118, 70 117.5, 66 116 Z" />
              <path d="M177 95 C 169 95, 162 98, 157 102 C 164 104.5, 171 103.5, 177 102 Z" />
              <path d="M175 111 C 168 110, 162 112, 159 116 C 165 118, 170 117.5, 174 116 Z" />
            </g>
            {/* cream brow spots + muzzle */}
            <ellipse cx="97" cy="75" rx="8" ry="4.6" fill="#FFF6E6" />
            <ellipse cx="143" cy="75" rx="8" ry="4.6" fill="#FFF6E6" />
            <path d="M80 121 C 84 104, 104 102, 120 110 C 136 102, 156 104, 160 121 C 162 141, 142 153, 120 153 C 98 153, 78 141, 80 121 Z" fill={url("cream")} />
            <ellipse className="cub-blush" cx="80" cy="127" rx="9" ry="5" fill="#FF8FA3" opacity="0.38" />
            <ellipse className="cub-blush" cx="160" cy="127" rx="9" ry="5" fill="#FF8FA3" opacity="0.38" />

            {/* eyes (open) */}
            <g className="cub-eyes-open">
              {[98, 142].map((cx) => (
                <g key={cx} className="cub-eye">
                  <ellipse cx={cx} cy="96" rx="13.5" ry="15.5" fill={url("eye")} />
                  <g className="cub-pupil">
                    <ellipse cx={cx} cy="98" rx="7.2" ry="8.4" fill="#0A0503" />
                    <circle cx={cx - 5} cy="89.5" r="4.8" fill="#fff" />
                    <circle cx={cx + 4.5} cy="103" r="2.1" fill="#fff" opacity="0.9" />
                  </g>
                  <path className="cub-water" d={`M${cx - 11} 104 Q${cx} 113 ${cx + 11} 104`} fill="none" stroke="#A5F3FC" strokeWidth="2.6" strokeLinecap="round" />
                </g>
              ))}
            </g>
            <g className="cub-eyes-closed" fill="none" stroke={FUR_STRIPE} strokeWidth="3.4" strokeLinecap="round">
              <path d="M86 98 Q98 106 110 98" />
              <path d="M130 98 Q142 106 154 98" />
            </g>
            <g className="cub-eyes-happy" fill="none" stroke={FUR_STRIPE} strokeWidth="3.6" strokeLinecap="round">
              <path d="M86 101 Q98 86 110 101" />
              <path d="M130 101 Q142 86 154 101" />
            </g>
            <g className="cub-brow-angry" stroke={FUR_STRIPE} strokeWidth="4.6" strokeLinecap="round">
              <path d="M84 77 L108 86" />
              <path d="M156 77 L132 86" />
            </g>
            <g className="cub-brow-worried" stroke={FUR_STRIPE} strokeWidth="3.8" strokeLinecap="round">
              <path d="M86 84 L107 76" />
              <path d="M154 84 L133 76" />
            </g>

            {/* nose + whisker dots */}
            <path d="M110 116 Q120 111 130 116 Q129 123 120 127 Q111 123 110 116 Z" fill={url("nose")} />
            <ellipse cx="116.5" cy="115.5" rx="3.2" ry="1.4" fill="#fff" opacity="0.7" />
            <g fill="#C9A27E">
              <circle cx="100" cy="128" r="1.4" /><circle cx="96" cy="133" r="1.4" /><circle cx="102" cy="134" r="1.4" />
              <circle cx="140" cy="128" r="1.4" /><circle cx="144" cy="133" r="1.4" /><circle cx="138" cy="134" r="1.4" />
            </g>

            {/* mouths (one shown per state) */}
            <path className="cub-mouth cub-mouth-smile" d="M120 127 L120 131 M110 130 Q115 137 120 131 Q125 137 130 130" fill="none" stroke="#5A2A1A" strokeWidth="2.3" strokeLinecap="round" />
            <g className="cub-mouth cub-mouth-open">
              <path d="M120 127 L120 131" stroke="#5A2A1A" strokeWidth="2.3" strokeLinecap="round" />
              <path d="M107 131 Q120 154 133 131 Q120 137 107 131 Z" fill="#7A1F2B" />
              <path d="M112.5 141 Q120 150 127.5 141 Q120 137.5 112.5 141 Z" fill="#F27A93" />
              <path d="M110 132 l3 4 l3 -3.5 M130 132 l-3 4 l-3 -3.5" fill="#fff" />
            </g>
            <path className="cub-mouth cub-mouth-frown" d="M120 127 L120 131 M110 139 Q120 130 130 139" fill="none" stroke="#5A2A1A" strokeWidth="2.3" strokeLinecap="round" />
            <g className="cub-mouth cub-mouth-pout">
              <path d="M120 127 L120 131" stroke="#5A2A1A" strokeWidth="2.3" strokeLinecap="round" />
              <ellipse cx="120" cy="136.5" rx="3.6" ry="3.1" fill="#7A1F2B" />
            </g>

            {/* tears, anger mark, sleep */}
            <path className="cub-tear cub-tear-l" d="M92 108 C 89 114, 88 117, 92 119 C 96 117, 95 114, 92 108 Z" fill="#7DD3FC" />
            <path className="cub-tear cub-tear-r" d="M148 108 C 145 114, 144 117, 148 119 C 152 117, 151 114, 148 108 Z" fill="#7DD3FC" />
            <path className="cub-anger" d="M162 50 Q168 50 168 44 M172 44 Q172 50 178 50 M178 54 Q172 54 172 60 M168 60 Q168 54 162 54" fill="none" stroke="#EF4444" strokeWidth="3.2" strokeLinecap="round" />
            <g className="cub-zzz" fill="#DDD6FE" stroke="#4C1D95" strokeWidth="1" paintOrder="stroke" fontFamily="var(--font-heading), sans-serif" fontWeight="800">
              <text x="170" y="46" fontSize="18">z</text>
              <text x="184" y="30" fontSize="23">z</text>
              <text x="198" y="10" fontSize="28">Z</text>
            </g>
          </g>

          {/* golden sales token (feeding) — between the head and the arms so the paws hug it */}
          <g className="cub-token">
            <circle cx="0" cy="0" r="25" fill={url("goldGlow")} />
            <circle cx="0" cy="0" r="15" fill={url("gold")} stroke="#B45309" strokeWidth="1.2" />
            <circle cx="0" cy="0" r="10.5" fill="none" stroke="#B45309" strokeWidth="1" opacity="0.55" />
            <path d="M-6 0.5 L-2 4.5 L6.5 -5" fill="none" stroke="#7C2D12" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle className="cub-bite" cx="12" cy="-9" r="6" fill="#0B1024" />
          </g>

          {/* arms (in front of the body; raised paws stay in front of the head) */}
          <g className="cub-arm cub-arm-l">
            <path d="M84 168 C 76 182, 74 198, 78 212 L95 212 C 97 198, 99 184, 99 172 Z" fill={url("sleeve")} stroke="#5B6BD0" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M77 207 L96 207 L96 214 L77 214 Z" fill="#7C3AED" />
            <path d="M77 207.5 L96 207.5" stroke="#67E8F9" strokeWidth="1.1" />
            <ellipse cx="86.5" cy="220" rx="11" ry="10" fill={url("furLimb")} />
            <ellipse cx="86.5" cy="222" rx="7.5" ry="5.6" fill={url("cream")} />
            <ellipse cx="86.5" cy="223.5" rx="3.6" ry="2.6" fill={url("pink")} />
            <path d="M80 214 l2 3 M86.5 213 l0 3 M93 214 l-2 3" stroke={FUR_STRIPE} strokeWidth="1.3" strokeLinecap="round" />
          </g>
          <g className="cub-arm cub-arm-r">
            <path d="M156 168 C 164 182, 166 198, 162 212 L145 212 C 143 198, 141 184, 141 172 Z" fill={url("sleeve")} stroke="#5B6BD0" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M163 207 L144 207 L144 214 L163 214 Z" fill="#7C3AED" />
            <path d="M163 207.5 L144 207.5" stroke="#C4B5FD" strokeWidth="1.1" />
            <ellipse cx="153.5" cy="220" rx="11" ry="10" fill={url("furLimb")} />
            <ellipse cx="153.5" cy="222" rx="7.5" ry="5.6" fill={url("cream")} />
            <ellipse cx="153.5" cy="223.5" rx="3.6" ry="2.6" fill={url("pink")} />
            <path d="M147 214 l2 3 M153.5 213 l0 3 M160 214 l-2 3" stroke={FUR_STRIPE} strokeWidth="1.3" strokeLinecap="round" />
            {/* trophy held in the right paw (bonus) */}
            <g className="cub-trophy">
              <circle cx="153.5" cy="196" r="26" fill={url("goldGlow")} />
              <path d="M140 186 L167 186 L165 200 Q153.5 212 142 200 Z" fill={url("gold")} stroke="#B45309" strokeWidth="1.2" />
              <path d="M140 189 Q131 190 134 198 Q137 203 143 201 M167 189 Q176 190 173 198 Q170 203 164 201" fill="none" stroke="#E5A00D" strokeWidth="2.4" />
              <rect x="150.5" y="205" width="6" height="7" fill="#D99A0F" />
              <rect x="145" y="211" width="17" height="5" rx="1.5" fill="#7C3AED" stroke="#C4B5FD" strokeWidth="0.8" />
              <path d="M153.5 190 l2 4 l4.4 0.6 l-3.2 3 l0.8 4.4 l-4 -2.1 l-4 2.1 l0.8 -4.4 l-3.2 -3 l4.4 -0.6 Z" fill="#FFF6C4" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
