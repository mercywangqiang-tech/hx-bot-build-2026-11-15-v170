// HXBot：手机端色块里落下、堆满的长颈鹿（布局见 hx-giraffe-pile-layout.ts）。
// 与桌面端、网页版的开屏动画是同一组角色：已设计的长颈鹿，六种颜色（@hxbot/brand/hx-animals），不带圆形底色。
//
// Each row is one SVG in its own view, and the rows drop in from the floor up, so the pile builds as
// it does on the desktop. Only the transform of a row view moves, on the UI thread; each SVG is drawn
// once. The giraffes stand side by side on their round bodies, so they do not run through each other.
import { HX_GIRAFFE } from "@hxbot/brand/app-logo-shape";
import { hxAnimalColors } from "@hxbot/brand/hx-animals";
import { memo, useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from "react-native-reanimated";
import Svg, { Circle, Defs, G, Path, Use } from "react-native-svg";

import { GIRAFFE_BOX, giraffePileLayout, PILE_BODY, type PileRow } from "./hx-giraffe-pile-layout";

const SCALE = (GIRAFFE_BOX * 0.92) / HX_GIRAFFE.height;
const FIGURE_TRANSFORM = `translate(${((GIRAFFE_BOX - HX_GIRAFFE.width * SCALE) / 2).toFixed(2)} ${(GIRAFFE_BOX * 0.04).toFixed(2)}) scale(${SCALE.toFixed(4)})`;
const SPOTS = HX_GIRAFFE.spots.join("");
/** The centre of the round body, as a share of the box, which a giraffe tilts around. */
const PIVOT = { x: 0.5, y: PILE_BODY.centre } as const;
/**
 * The six colours of the crew, as on the desktop: orange, green, pink, purple, red and yellow, the
 * avatar hues nearest to the colours of the six characters that the pile had before.
 */
const COLORS = [30, 150, 320, 280, 0, 55].map((hue) => hxAnimalColors(hue));
/** The eye of the avatar giraffe, in the units of the figure: a dark dot with a glint. */
const EYE = { r: 2.6 * (HX_GIRAFFE.height / 90), glint: 0.9 * (HX_GIRAFFE.height / 90) } as const;
/** A row starts its drop this long after the row under it, in ms. */
const ROW_STAGGER_MS = 70;
const DROP_SPRING = { damping: 15, stiffness: 150, mass: 0.9 } as const;

function figureId(color: number): string {
  return `hx-pile-giraffe-${color}`;
}

function RowGiraffes({ row, width, edge }: { row: PileRow; width: number; edge: string }) {
  // One figure for each colour that the row has; each giraffe shows the figure of its colour.
  const used = [...new Set(row.giraffes.map((giraffe) => giraffe.color))];
  return (
    <Svg width={width} height={row.height}>
      <Defs>
        {used.map((color) => {
          const colors = COLORS[color] ?? COLORS[0];
          if (!colors) return null;
          return (
            <G key={color} id={figureId(color)}>
              {/* A thin edge in the colour of the block keeps a head apart from the giraffe behind it. */}
              <Path d={HX_GIRAFFE.body} fill={colors.body} stroke={edge} strokeWidth={9} strokeLinejoin="round" />
              <Path d={HX_GIRAFFE.body} fill={colors.body} />
              <Path d={SPOTS} fill={colors.accent} />
              <Circle cx={HX_GIRAFFE.eye.cx} cy={HX_GIRAFFE.eye.cy + EYE.glint} r={EYE.r} fill={colors.dark} />
              <Circle cx={HX_GIRAFFE.eye.cx - EYE.glint} cy={HX_GIRAFFE.eye.cy} r={EYE.glint} fill={colors.white} />
            </G>
          );
        })}
      </Defs>
      {row.giraffes.map((giraffe) => {
        const scale = giraffe.size / GIRAFFE_BOX;
        const pivotX = GIRAFFE_BOX * PIVOT.x;
        const pivotY = GIRAFFE_BOX * PIVOT.y;
        return (
          <G
            key={`${giraffe.x.toFixed(1)}:${giraffe.y.toFixed(1)}`}
            transform={`translate(${giraffe.x.toFixed(2)} ${giraffe.y.toFixed(2)}) scale(${scale.toFixed(5)}) rotate(${giraffe.tilt} ${pivotX} ${pivotY})`}
          >
            <G transform={FIGURE_TRANSFORM}>
              <Use href={`#${figureId(giraffe.color)}`} />
            </G>
          </G>
        );
      })}
    </Svg>
  );
}

const DroppingRow = memo(function DroppingRow({
  row,
  order,
  width,
  edge,
  drop,
}: {
  row: PileRow;
  order: number;
  width: number;
  edge: string;
  /** How far above its place the row starts, in points; 0 draws it in place. */
  drop: number;
}) {
  const offset = useSharedValue(-drop);
  useEffect(() => {
    if (drop === 0) {
      offset.set(0);
      return;
    }
    offset.set(withDelay(order * ROW_STAGGER_MS, withSpring(0, DROP_SPRING)));
  }, [drop, offset, order]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.row, { top: row.top, width, height: row.height }, style]}>
      <RowGiraffes row={row} width={width} edge={edge} />
    </Animated.View>
  );
});

/**
 * The giraffes that fill a block of `width` by `height` points, with their feet on its lower edge.
 * They drop in once when `animate` is set; a reduced-motion user and the app lock see the pile still.
 * `edge` is the colour around each giraffe, the colour of the block.
 */
export function HxGiraffePile({
  width,
  height,
  edge,
  animate,
}: {
  width: number;
  height: number;
  edge: string;
  animate: boolean;
}) {
  const layout = useMemo(() => giraffePileLayout(width, height), [width, height]);
  return (
    <View pointerEvents="none" style={[styles.pile, { width, height }]}>
      {layout.rows.map((row, order) => (
        <DroppingRow
          // A new size makes a new layout, whose rows drop in again.
          key={`${width}x${height}:${row.top}`}
          row={row}
          order={order}
          width={width}
          edge={edge}
          drop={animate ? height + row.height : 0}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pile: { position: "absolute", left: 0, bottom: 0, overflow: "hidden" },
  row: { position: "absolute", left: 0 },
});
