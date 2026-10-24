import { BEVEL } from "./geometry";

const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du.x * (b - a + k * u.y), du.y * (c - a + k * u.x));
}

float caustic(vec2 p, float t) {
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
  float a = noised(p * 0.75 + vec2(t * 0.23, t * 0.17)).x;
  float b = noised(q * 1.1 - vec2(t * 0.19, -t * 0.21)).x;
  float r1 = 1.0 - abs(a * 2.0 - 1.0);
  float r2 = 1.0 - abs(b * 2.0 - 1.0);
  return pow(r1 * r2, 5.0) * 2.2;
}
`;

const SHADOW = `
#ifdef SHADOWS
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
uniform float uShadowBias;
const vec2 DISK[8] = vec2[](vec2(-0.613, 0.617), vec2(0.17, -0.04), vec2(-0.299, -0.792), vec2(0.645, 0.493), vec2(-0.651, -0.109), vec2(0.421, -0.695), vec2(0.017, 0.988), vec2(0.926, -0.165));
float shadowAt(vec4 sc) {
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float s = 0.0;
  for (int i = 0; i < 8; i++) s += texture(uShadowMap, vec3(p.xy + DISK[i] * uShadowTexel * 1.8, p.z - uShadowBias));
  return s / 8.0;
}
#else
float shadowAt(vec4 sc) {
  return 1.0;
}
#endif
`;

const SKY = `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSun;
vec3 skyColour(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));
  float s = max(dot(d, uSunDir), 0.0);
  return c + uSun * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.12);
}
`;

export const HEX_VERTEX = `
in float aPart;
in float aDrop;
in vec4 iCell;
in vec4 iInfo;
in vec3 iNow;
in vec2 iWas;
in float iEdge;

uniform float uNow;
uniform float uRise;
uniform float uBlend;
uniform float uHeightScale;
uniform float uFlat;
uniform float uCellScale;
uniform float uLens;
uniform vec3 uSlots[11];
uniform vec3 uRoles[5];
uniform vec3 uLangs[10];
uniform vec3 uStale[4];
uniform vec3 uSnow;
uniform vec3 uRuin;
uniform vec3 uDim;
uniform float uFrost;
uniform vec2 uFocus;
uniform vec2 uRegion;
uniform float uRegionMix;
uniform float uRoleMask;
uniform float uSolo;
uniform float uHover;
uniform float uSelected;
uniform float uFlashSpan;
uniform float uFlashGain;
uniform float uNight;
uniform float uRotate;
uniform float uBottom;
uniform mat4 uShadowMatrix;

out vec3 vColour;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vLocal;
out float vTopY;
out float vBorders;
out float vGlow;
out float vMark;
out float vSea;
out float vRegion;
out float vEdge;
out float vShown;
out vec4 vShadow;
flat out float vId;

vec3 slotColour(float i) {
  return uSlots[int(clamp(i, 0.0, 10.0) + 0.5)];
}

float bucketOf(float age) {
  return age < 13.0 ? 0.0 : age < 52.0 ? 1.0 : age < 104.0 ? 2.0 : 3.0;
}

float hash1(float n) {
  return fract(sin(n * 12.9898 + 4.1) * 43758.5453);
}

void main() {
  float born = iCell.z;
  float died = iCell.w;
  float rank = iInfo.w;
  float rise = uRise > 0.0 ? clamp((uNow - born) / uRise, 0.0, 1.0) : step(born, uNow);
  float sink = uRise > 0.0 ? clamp((uNow - died) / uRise, 0.0, 1.0) : step(died, uNow);
  float hidden = born > uNow ? 1.0 : 0.0;
  float commits = mix(iWas.x, iNow.x, uBlend);
  float land = uHeightScale * (0.35 + 0.42 * log2(1.0 + commits));
  float focused = (uFocus.x < 0.0 || (rank >= uFocus.x && rank < uFocus.y)) ? 1.0 : 0.0;
  float roleOn = mod(floor(uRoleMask / pow(2.0, iInfo.y)), 2.0);
  float soloOn = uSolo > 0.5 ? (abs(iNow.y - 10.0) < 0.5 ? 1.0 : 0.0) : 1.0;
  float shown = focused * roleOn * soloOn;
  land = mix(0.2, land, mix(0.3, 1.0, shown));
  land = mix(land, 0.28, uFlat);
  float region = (rank >= uRegion.x && rank < uRegion.y) ? uRegionMix : 0.0;
  land += region * (0.1 + land * 0.06);
  float lift = rise * (1.0 - rise) * 4.0 * 0.6 * step(0.001, uRise);
  float top = mix(-1.0, land + lift, rise);
  float ruin = -0.24 - 0.22 * hash1(rank);
  top = mix(top, ruin, sink);

  float c = cos(uRotate);
  float s = sin(uRotate);
  mat2 turn = mat2(c, -s, s, c);
  vec3 p = position;
  p.xz = turn * p.xz;
  p.xz *= uCellScale * (1.0 - hidden);
  p.y = aPart < 0.5 ? uBottom : top - aDrop;
  vec3 n = normal;
  n.xz = turn * n.xz;
  vec3 world = vec3(p.x + iCell.x, p.y, p.z + iCell.y);
  vWorld = world;
  vNormal = n;
  vLocal = position.xz / ${(1 - BEVEL).toFixed(4)};
  vTopY = top;
  vBorders = iInfo.x;
  vSea = sink;
  vId = rank;
  vRegion = region;
  vEdge = iEdge;
  vShown = shown;

  float age = uNow - iNow.z;
  vec3 base;
  if (uLens < 0.5) {
    vec3 was = slotColour(iWas.y);
    vec3 now = slotColour(iNow.y);
    base = mix(was, now, uBlend);
    float b = bucketOf(age);
    float frost = b < 0.5 ? 0.0 : b < 1.5 ? 0.25 : b < 2.5 ? 0.55 : 0.9;
    base = mix(base, uSnow, frost * uFrost);
  } else if (uLens < 1.5) {
    base = uRoles[int(iInfo.y + 0.5)];
  } else if (uLens < 2.5) {
    base = uStale[int(bucketOf(age) + 0.5)];
  } else {
    base = uLangs[int(iInfo.z + 0.5)];
  }
  base = mix(uDim, base, shown);
  base = mix(base, uRuin, sink);
  vColour = base;

  float flash = age >= 0.0 && age < uFlashSpan ? 1.0 - age / uFlashSpan : 0.0;
  float city = uNight * (age >= 0.0 && age < 4.0 ? (1.0 - age / 4.0) * 0.35 : 0.0);
  vGlow = (flash * uFlashGain + city) * shown * (1.0 - sink) * (1.0 - hidden);
  vMark = abs(rank - uSelected) < 0.5 ? 2.0 : abs(rank - uHover) < 0.5 ? 1.0 : 0.0;
  vShadow = uShadowMatrix * vec4(world + n * 0.05, 1.0);

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const HEX_FRAGMENT = `
in vec3 vColour;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vLocal;
in float vTopY;
in float vBorders;
in float vGlow;
in float vMark;
in float vSea;
in float vRegion;
in float vEdge;
in float vShown;
in vec4 vShadow;
flat in float vId;

uniform vec3 uGround;
uniform vec3 uSkyLight;
uniform vec4 uBorder;
uniform float uNight;
uniform vec3 uGlow;
uniform vec3 uMarkColour;
uniform vec3 uOutline;
uniform vec3 uRelease;
uniform vec3 uAbsorb;
uniform vec4 uBeacons[8];
uniform vec3 uBeaconColours[8];
uniform int uBeaconCount;
uniform vec4 uSweep;

const float PI = 3.14159265;
${SKY}
${SHADOW}

void main() {
#ifdef PICK
  float id = vId + 1.0;
  gl_FragColor = vec4(mod(id, 256.0) / 255.0, mod(floor(id / 256.0), 256.0) / 255.0, floor(id / 65536.0) / 255.0, 1.0);
#elif defined(DEPTH)
  gl_FragColor = vec4(1.0);
#elif defined(MASK)
  gl_FragColor = vec4(vTopY > 0.02 && vSea < 0.5 ? 1.0 : 0.0, 1.0, 0.0, 1.0);
#else
#ifdef REFLECT
  if (vWorld.y < 0.0) discard;
#endif
  vec3 N = normalize(vNormal);
  bool isTop = vNormal.y > 0.95;
  bool isRim = !isTop && vNormal.y > 0.3;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 albedo = vColour;
  vec3 emit = vec3(0.0);

  float ang = atan(vLocal.y, vLocal.x);
  float k = mod(floor(-ang / (PI / 3.0) + 0.5) + 6.0, 6.0);
  float a = -k * PI / 3.0;
  float dist = 0.866 - dot(vLocal, vec2(cos(a), sin(a)));
  if (isTop) {
    float level = mod(floor(vBorders / pow(4.0, k) + 0.001), 4.0);
    float width = level > 2.5 ? 0.16 : level > 1.5 ? 0.1 : level > 0.5 ? 0.05 : 0.0;
    float edge = 1.0 - smoothstep(width * 0.55, width, dist);
    float strength = level > 2.5 ? 0.9 : level > 1.5 ? 0.6 : 0.35;
    albedo = mix(albedo, uBorder.rgb, uBorder.a * strength * edge * (1.0 - vSea));
    if (vMark > 0.5) {
      float ring = 1.0 - smoothstep(0.12, 0.22, dist);
      albedo = mix(albedo, uMarkColour, (vMark > 1.5 ? 0.9 : 0.65) * ring);
      emit += uMarkColour * ring * (vMark > 1.5 ? 0.5 : 0.3);
    }
  }
  if (vEdge > 63.5 && (isTop || isRim)) {
    float bits = vEdge - 64.0;
    float on = mod(floor(bits / pow(2.0, k) + 0.001), 2.0);
    float line = isRim ? 1.0 : 1.0 - smoothstep(0.05, 0.12, dist);
    emit += uOutline * on * line * vRegion * 1.6;
  }
  emit += albedo * 0.14 * vRegion;

  float shadow = shadowAt(vShadow);
  float under = max(0.0, -vWorld.y);
  vec3 sun = uSun * exp(-uAbsorb * under * 1.6);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 hemi = mix(uGround, uSkyLight, N.y * 0.5 + 0.5);
  float ao = isTop ? 1.0 : isRim ? 0.95 : mix(0.42, 1.0, exp(-max(0.0, vTopY - vWorld.y) * 0.5));
  vec3 H = normalize(V + uSunDir);
  float shine = isRim ? 120.0 : isTop ? 36.0 : 16.0;
  float fresnelH = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float spec = pow(max(dot(N, H), 0.0), shine) * (shine + 8.0) / (8.0 * PI) * fresnelH;
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = albedo * (sun * ndl * shadow + hemi * ao);
  col += sun * spec * ndl * shadow * (isRim ? 1.4 : 0.6);
  col += skyColour(reflect(-V, N)) * fresnel * (isRim ? 0.55 : 0.3) * ao;

  for (int i = 0; i < 8; i++) {
    if (i >= uBeaconCount) break;
    vec4 b = uBeacons[i];
    vec2 d = vWorld.xz - b.xy;
    float w = b.w * exp(-dot(d, d) / (b.z * b.z));
    emit += uBeaconColours[i] * w * (0.15 + 0.55 * max(N.y, 0.0)) * vShown;
  }
  if (uSweep.w > 0.0) {
    float d = dot(vWorld.xz, uSweep.yz) - uSweep.x;
    float band = exp(-d * d / (uSweep.w * uSweep.w));
    emit += uRelease * band * (isTop ? 1.4 : 0.5) * (0.35 + 0.65 * vShown) * (1.0 - vSea);
  }
  emit += uGlow * vGlow * (uNight > 0.5 ? 2.4 : 1.3) * (isTop ? 1.0 : isRim ? 0.8 : 0.3);
  gl_FragColor = vec4(col + emit, 1.0);
#endif
}
`;

export const SEABED_VERTEX = `
uniform sampler2D tLand;
uniform vec4 uArea;
uniform float uDeep;
uniform mat4 uShadowMatrix;
out vec3 vWorld;
out float vCoast;
out vec4 vShadow;

float floorAt(float d) {
  return -0.5 - (uDeep - 0.5) * smoothstep(0.0, 1.0, d);
}

void main() {
  vec2 st = (position.xz - uArea.xy) / uArea.zw;
  float inside = step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0);
#ifdef FAR
  float d = 1.0;
  float y = -uDeep - 0.03;
#else
  float d = mix(1.0, 1.0 - smoothstep(0.0, 0.5, textureLod(tLand, vec2(st.x, 1.0 - st.y), 0.0).g), inside);
  float y = floorAt(d);
#endif
  vec3 world = vec3(position.x, y, position.z);
  vWorld = world;
  vCoast = d;
  vShadow = uShadowMatrix * vec4(world + vec3(0.0, 0.05, 0.0), 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const SEABED_FRAGMENT = `
in vec3 vWorld;
in float vCoast;
in vec4 vShadow;
uniform vec3 uSand;
uniform vec3 uSeabed;
uniform vec3 uGround;
uniform vec3 uSkyLight;
uniform vec3 uAbsorb;
${SKY}
${NOISE}
${SHADOW}

void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (N.y < 0.0) N = -N;
  float grain = noised(vWorld.xz * 1.7).x * 0.5 + noised(vWorld.xz * 0.35).x * 0.5;
  vec3 albedo = mix(uSand, uSeabed, smoothstep(0.02, 0.6, vCoast));
  albedo *= 0.86 + 0.24 * grain;
  float under = max(0.0, -vWorld.y);
  vec3 sun = uSun * exp(-uAbsorb * under * 1.6);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 col = albedo * (sun * ndl * shadowAt(vShadow) + mix(uGround, uSkyLight, 0.7));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCREEN_VERTEX = `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const WATER_FRAGMENT = `
in vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tReflect;
uniform sampler2D tLand;
uniform vec4 uArea;
uniform mat4 uInverse;
uniform mat4 uViewProjection;
uniform vec3 uCam;
uniform float uTime;
uniform float uPixel;
uniform float uReflect;
uniform vec3 uScatter;
uniform vec3 uAbsorb;
uniform vec3 uFoam;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uGround;
uniform vec3 uSkyLight;
uniform float uCaustics;
uniform float uWaves;
uniform mat4 uShadowMatrix;
${SKY}
${NOISE}
${SHADOW}

vec3 worldAt(vec2 uv, float d) {
  vec4 p = uInverse * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

vec2 wave(vec2 p, vec2 dir, float length, float slope, float t, float foot) {
  float k = 6.2831853 / length;
  float speed = sqrt(9.8 / k) * 0.55;
  float phase = dot(dir, p) * k - t * speed * k;
  float fade = 1.0 - smoothstep(length * 0.12, length * 0.4, foot);
  return dir * cos(phase) * slope * fade;
}

vec3 waterNormal(vec2 p, float t, float foot, float calm) {
  vec2 g = vec2(0.0);
  vec2 warp = vec2(noised(p * 0.07 + vec2(3.1, 7.7)).x, noised(p * 0.07 + vec2(11.3, 1.9)).x) - 0.5;
  p += warp * 9.0;
  g += wave(p, normalize(vec2(1.0, 0.35)), 31.0, 0.035, t, foot);
  g += wave(p, normalize(vec2(-0.55, 1.0)), 17.0, 0.03, t, foot);
  float mid = 1.0 - smoothstep(0.07, 0.3, foot);
  g += noised(p * 0.09 + vec2(-t * 0.05, t * 0.04)).yz * 0.05;
  float fine = 1.0 - smoothstep(0.03, 0.16, foot);
  vec3 n0 = noised(p * 0.42 + vec2(t * 0.12, -t * 0.09));
  vec3 n1 = noised(mat2(0.8, -0.6, 0.6, 0.8) * p * 1.15 + vec2(t * 0.31, t * 0.2));
  vec3 n2 = noised(mat2(0.6, 0.8, -0.8, 0.6) * p * 2.7 - vec2(t * 0.26, -t * 0.38));
  g += n0.yz * 0.07 * mid + n1.yz * 0.045 * fine + n2.yz * 0.022 * fine;
  g *= uWaves * mix(0.45, 1.0, calm);
  return normalize(vec3(-g.x, 1.0, -g.y));
}

float depthOf(vec3 w) {
  vec4 c = uViewProjection * vec4(w, 1.0);
  return clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
  float d = texture(tDepth, vUv).r;
  vec3 far = worldAt(vUv, 1.0);
  vec3 dir = normalize(far - uCam);
  vec3 scene = texture(tColor, vUv).rgb;
  vec3 P = d < 1.0 ? worldAt(vUv, d) : far;
  float tScene = d < 1.0 ? length(P - uCam) : 1e9;
  float tWater = dir.y < -1e-5 ? -uCam.y / dir.y : 1e9;
  vec3 col;
  float t;
  float depth;
  if (tScene <= tWater) {
    col = d < 1.0 ? scene : skyColour(dir);
    t = tScene;
    depth = d;
  } else {
    vec3 W = uCam + dir * tWater;
    vec2 st = (W.xz - uArea.xy) / uArea.zw;
    float inside = step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0);
    float foot = tWater * uPixel;
    vec3 N = waterNormal(W.xz, uTime, foot, 1.0 - inside * texture(tLand, vec2(st.x, 1.0 - st.y)).r);
    vec3 V = -dir;
    float cosT = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

    vec2 ruv = vUv + N.xz * 0.045 * clamp(0.6 - P.y, 0.0, 1.0) / max(1.0, foot * 4.0);
    float d2 = texture(tDepth, ruv).r;
    vec3 P2 = d2 < 1.0 ? worldAt(ruv, d2) : far;
    if (P2.y > 0.0 || d2 >= 1.0) {
      ruv = vUv;
      P2 = P;
    }
    vec3 under = texture(tColor, ruv).rgb;
    float vdepth = max(0.0, -P2.y);
    float path = min(length(P2 - W), 60.0);
    float lit = shadowAt(uShadowMatrix * vec4(P2, 1.0));
    under += under * caustic(P2.xz, uTime) * uCaustics * exp(-vdepth * 0.7) * lit;
    vec3 Tv = exp(-uAbsorb * path);
    float sunAmount = clamp(uSunDir.y, 0.0, 1.0);
    vec3 scatter = uScatter * (0.55 + 0.45 * sunAmount);
    vec3 water = under * Tv + scatter * (1.0 - Tv);

    vec3 R = reflect(dir, N);
    R.y = abs(R.y);
    vec3 refl = skyColour(R);
    if (uReflect > 0.5) {
      vec4 rt = texture(tReflect, vUv + N.xz * 0.03 / max(1.0, foot * 3.0));
      refl = mix(refl, rt.rgb, rt.a);
    }
    float surfaceLit = shadowAt(uShadowMatrix * vec4(W, 1.0));
    vec3 H = normalize(V + uSunDir);
    float rough = smoothstep(0.02, 0.18, foot);
    float nh = max(dot(N, H), 0.0);
    float sparkle = smoothstep(0.45, 0.95, noised(W.xz * 3.7 + vec2(uTime * 0.9, -uTime * 0.7)).x);
    float glint = min(6.0, pow(nh, mix(1400.0, 120.0, rough)) * mix(24.0, 0.4, rough) * mix(mix(0.15, 1.5, sparkle), 1.0, rough)) + pow(nh, 40.0) * 0.05;
    col = mix(water, refl, F) + uSun * glint * surfaceLit;

    float shallow = max(0.0, -P.y);
    float ring = 1.0 - smoothstep(0.0, 0.3, shallow);
    float near = inside * texture(tLand, vec2(st.x, 1.0 - st.y)).r;
    float belt = smoothstep(0.06, 0.4, near);
    float n = noised(W.xz * 0.9 + vec2(uTime * 0.16, uTime * 0.11)).x * 0.6 + noised(W.xz * 2.3 - vec2(uTime * 0.21, uTime * 0.07)).x * 0.4;
    float mask = max(ring, belt);
    float foam = smoothstep(0.0, 0.22, mask * 1.3 - n * 0.85 - 0.18);
    foam *= 1.0 - smoothstep(0.6, 2.4, foot);
    vec3 foamLight = uFoam * (uSun * max(uSunDir.y, 0.0) * surfaceLit + mix(uGround, uSkyLight, 0.8));
    col = mix(col, foamLight, clamp(foam, 0.0, 1.0) * 0.8);
    t = tWater;
    depth = depthOf(W);
  }
  if (d < 1.0 || tWater < 1e8) col = mix(col, uFog, smoothstep(uFogNear, uFogFar, t));
  gl_FragColor = vec4(col, 1.0);
  gl_FragDepth = depth;
}
`;

export const BLUR_FRAGMENT = `
in vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uStep;
void main() {
  vec2 s = texture(tInput, vUv).rg * 0.2270;
  s += (texture(tInput, vUv + uStep * 1.3846).rg + texture(tInput, vUv - uStep * 1.3846).rg) * 0.3162;
  s += (texture(tInput, vUv + uStep * 3.2308).rg + texture(tInput, vUv - uStep * 3.2308).rg) * 0.0703;
  gl_FragColor = vec4(s, 0.0, 1.0);
}
`;
