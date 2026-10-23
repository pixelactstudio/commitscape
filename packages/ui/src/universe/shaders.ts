export const HEX_VERTEX = `
in float aTop;
in vec4 iCell;
in vec4 iInfo;
in vec3 iNow;
in vec2 iWas;

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
uniform vec3 uSeabed;
uniform vec3 uDim;
uniform float uFrost;
uniform vec2 uFocus;
uniform float uRoleMask;
uniform float uHover;
uniform float uSelected;
uniform float uFlashSpan;
uniform float uFlashGain;
uniform float uNight;
uniform float uRotate;

out vec3 vColour;
out vec3 vWorld;
out vec2 vLocal;
out float vTop;
out float vBorders;
out float vShade;
out float vGlow;
out float vMark;
out float vSea;
flat out float vId;

vec3 slotColour(float i) {
  return uSlots[int(clamp(i, 0.0, 10.0) + 0.5)];
}

float bucketOf(float age) {
  return age < 13.0 ? 0.0 : age < 52.0 ? 1.0 : age < 104.0 ? 2.0 : 3.0;
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
  float shown = focused * roleOn;
  land = mix(0.28, land, mix(0.35, 1.0, shown));
  land = mix(land, 0.28, uFlat);
  float lift = rise * (1.0 - rise) * 4.0 * 0.6 * step(0.001, uRise);
  float top = mix(-1.0, land + lift, rise);
  top = mix(top, -0.42, sink);
  float bottom = -1.4;
  vec3 p = position;
  float c = cos(uRotate);
  float s = sin(uRotate);
  p.xz = mat2(c, -s, s, c) * p.xz;
  p.xz *= uCellScale * (1.0 - hidden);
  p.y = mix(bottom, top, position.y);
  vec3 world = vec3(p.x + iCell.x, p.y, p.z + iCell.y);
  vWorld = world;
  vLocal = position.xz;
  vTop = aTop;
  vBorders = iInfo.x;
  vShade = clamp((world.y - bottom) / max(0.001, top - bottom), 0.0, 1.0);
  vSea = sink;
  vId = rank;

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
  base = mix(uDim, base, mix(0.18, 1.0, shown));
  base = mix(base, uSeabed, sink);
  vColour = base;

  float flash = age >= 0.0 && age < uFlashSpan ? 1.0 - age / uFlashSpan : 0.0;
  float city = uNight * (age >= 0.0 && age < 4.0 ? (1.0 - age / 4.0) * 0.35 : 0.0);
  vGlow = (flash * uFlashGain + city) * shown * (1.0 - sink) * (1.0 - hidden);
  vMark = abs(rank - uSelected) < 0.5 ? 2.0 : abs(rank - uHover) < 0.5 ? 1.0 : 0.0;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const HEX_FRAGMENT = `
in vec3 vColour;
in vec3 vWorld;
in vec2 vLocal;
in float vTop;
in float vBorders;
in float vShade;
in float vGlow;
in float vMark;
in float vSea;
flat in float vId;

uniform vec3 uKeyDir;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec4 uBorder;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uNight;
uniform vec3 uGlow;
uniform vec3 uMarkColour;

const float PI = 3.14159265;

void main() {
#ifdef PICK
  float id = vId + 1.0;
  gl_FragColor = vec4(mod(id, 256.0) / 255.0, mod(floor(id / 256.0), 256.0) / 255.0, floor(id / 65536.0) / 255.0, 1.0);
#else
  vec3 col = vColour;
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (vTop > 0.5) {
    float ang = atan(vLocal.y, vLocal.x);
    float k = mod(floor(-ang / (PI / 3.0) + 0.5) + 6.0, 6.0);
    float a = -k * PI / 3.0;
    float dist = 0.866 - dot(vLocal, vec2(cos(a), sin(a)));
    float level = mod(floor(vBorders / pow(4.0, k) + 0.001), 4.0);
    float width = level > 2.5 ? 0.2 : level > 1.5 ? 0.12 : level > 0.5 ? 0.06 : 0.0;
    float edge = 1.0 - smoothstep(width * 0.6, width, dist);
    float strength = level > 2.5 ? 1.0 : level > 1.5 ? 0.7 : 0.45;
    col = mix(col, uBorder.rgb, uBorder.a * strength * edge * (1.0 - vSea));
    float rim = 1.0 - smoothstep(0.02, 0.07, dist);
    col *= 1.0 + 0.05 * rim;
    float ghost = (1.0 - smoothstep(0.04, 0.11, dist)) * vSea;
    col = mix(col, vec3(1.0), ghost * 0.28);
    float key = clamp(dot(vec3(0.0, 1.0, 0.0), uKeyDir), 0.0, 1.0);
    col *= 0.96 + 0.06 * key;
    if (vMark > 0.5) {
      float ring = 1.0 - smoothstep(0.1, 0.2, dist);
      col = mix(col, uMarkColour, (vMark > 1.5 ? 0.9 : 0.6) * ring);
      col = mix(col, uMarkColour, vMark > 1.5 ? 0.18 : 0.1);
    }
  } else {
    float lambert = clamp(dot(n, uKeyDir), 0.0, 1.0);
    vec3 hemi = mix(uGround, uSky, n.y * 0.5 + 0.5);
    float ao = mix(0.45, 1.0, smoothstep(0.0, 1.0, vShade));
    col = col * (0.58 + 0.3 * lambert) * ao + hemi * 0.04;
  }
  col += uGlow * vGlow * (uNight > 0.5 ? 1.0 : 0.6);
  float d = length(vWorld - cameraPosition);
  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
#endif
}
`;

export const SEA_VERTEX = `
out vec3 vWorld;
out vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SEA_FRAGMENT = `
in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uDistance;
uniform vec4 uArea;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uNight;
uniform vec3 uKeyDir;

float wave(vec2 p) {
  return sin(p.x * 0.35 + uTime * 0.6) * 0.5 + sin(p.y * 0.29 - uTime * 0.45) * 0.5 + sin((p.x + p.y) * 0.17 + uTime * 0.3) * 0.5;
}

void main() {
  vec2 st = (vWorld.xz - uArea.xy) / uArea.zw;
  float dist = texture(uDistance, st).r;
  float inside = step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0);
  dist = mix(1.0, dist, inside);
  float shallow = 1.0 - smoothstep(0.0, 0.55, dist);
  vec3 col = mix(uDeep, uShallow, shallow * shallow);
  float foam = (1.0 - smoothstep(0.0, 0.04, dist)) * (0.5 + 0.5 * sin(dist * 160.0 - uTime * 1.5));
  col = mix(col, uFoam, foam * 0.25);
  vec2 e = vec2(0.6, 0.0);
  vec3 n = normalize(vec3(wave(vWorld.xz + e.xy) - wave(vWorld.xz - e.xy), 6.0, wave(vWorld.xz + e.yx) - wave(vWorld.xz - e.yx)));
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 h = normalize(view + uKeyDir);
  float spec = pow(clamp(dot(n, h), 0.0, 1.0), 120.0);
  col += spec * (uNight > 0.5 ? 0.08 : 0.18);
  float d = length(vWorld - cameraPosition);
  float fog = smoothstep(uFogNear, uFogFar, d);
  col = mix(col, uFog, fog);
  float alpha = mix(0.62, 0.94, smoothstep(0.0, 0.25, dist));
  alpha = mix(alpha, 1.0, fog);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

export const STRIKE_VERTEX = `
in vec3 iFrom;
in vec3 iTo;
in vec3 iColour;
in vec2 iTime;
uniform float uWall;
uniform float uWidth;
out vec3 vColour;
out float vFade;
out float vSide;
out float vAlong;

float hash(float x) {
  return fract(sin(x * 91.17) * 43758.5453);
}

void main() {
  float t = position.x;
  float age = uWall - iTime.x;
  float life = 0.6;
  float grow = clamp(age / 0.12, 0.0, 1.0);
  t *= grow;
  vec3 p = mix(iFrom, iTo, t);
  float arc = sin(t * 3.14159) * length(iTo - iFrom) * 0.12;
  p.y += arc;
  vec3 dir = normalize(iTo - iFrom + vec3(0.0, 0.001, 0.0));
  vec3 view = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, view));
  float seg = floor(position.x * 8.0);
  float jitter = (hash(seg + iTime.y * 13.0) - 0.5) * 2.0 * sin(t * 3.14159) * 0.6;
  p += side * jitter;
  float width = uWidth * (1.0 + 0.4 * (1.0 - t));
  p += side * position.y * width;
  vColour = iColour;
  vFade = age < 0.0 ? 0.0 : clamp(1.0 - age / life, 0.0, 1.0);
  vSide = position.y;
  vAlong = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const STRIKE_FRAGMENT = `
in vec3 vColour;
in float vFade;
in float vSide;
in float vAlong;
uniform float uNight;
void main() {
  if (vFade <= 0.0) discard;
  float core = 1.0 - abs(vSide);
  vec3 col = mix(vColour, vec3(1.0), core * core * core * (uNight > 0.5 ? 0.5 : 0.25));
  float a = vFade * smoothstep(0.0, 0.7, core) * (uNight > 0.5 ? 0.8 : 1.0);
  gl_FragColor = vec4(col * (uNight > 0.5 ? a : 1.0), uNight > 0.5 ? a : a * 0.9);
  #include <colorspace_fragment>
}
`;

export const RING_VERTEX = `
in vec4 iRing;
in vec3 iColour;
in vec2 iTime;
uniform float uWall;
out vec2 vPos;
out vec3 vColour;
out float vAge;
out float vRadius;
void main() {
  float age = (uWall - iTime.x) / iTime.y;
  float r = iRing.z;
  vec3 p = vec3(iRing.x + position.x * r, iRing.w, iRing.y + position.y * r);
  vPos = position.xy;
  vColour = iColour;
  vAge = age;
  vRadius = r;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const RING_FRAGMENT = `
in vec2 vPos;
in vec3 vColour;
in float vAge;
in float vRadius;
uniform float uNight;
void main() {
  if (vAge < 0.0 || vAge > 1.0) discard;
  float d = length(vPos);
  float front = 1.0 - pow(1.0 - vAge, 3.0);
  float width = max(0.012, 1.6 / vRadius);
  float band = 1.0 - smoothstep(0.0, width, abs(d - front));
  float trail = smoothstep(front - width * 6.0, front, d) * step(d, front) * 0.25;
  float a = (band + trail) * (1.0 - vAge);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColour * (uNight > 0.5 ? a : 1.0), uNight > 0.5 ? a : a * 0.85);
  #include <colorspace_fragment>
}
`;
