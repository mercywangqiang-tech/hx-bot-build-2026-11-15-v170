/**
 * HXBot (v1.7.5, UI-27): the start film "长颈鹿与气球" on the first start and the first start after each
 * update, over the start screen. White backdrop, full screen, at the film's own proportions: it covers
 * the screen, and where the screen cuts it the logo and the name stay whole (`hxBootFit`, shared with
 * the desktop and the web). The film's first frame shows until the film plays; the end fades into the
 * app. A tap one second in goes on, a tap before it does nothing; Android's back button does the same
 * and never reaches the app behind the film. A film that is stuck can be tapped away 2 s after it came
 * and goes by itself 20 s after it came. Reduced motion, a film that fails, or one that has not started
 * one second after it came: no film. The app starts behind it as always.
 */
import { hxBootFit } from "@hxbot/contracts/hx-boot";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Image, Pressable, useWindowDimensions } from "react-native";
import { type HxBootAspect, hxBootAspect, markHxBootPlayed, useHxBoot } from "@/features/boot/model/hx-boot";
import { useReducedMotion } from "@/shared/lib/motion";

const FILMS: Record<HxBootAspect, number> = {
  "16x9": require("../../../../assets/hx-boot/hxbot-boot-16x9.mp4"),
  "4x3": require("../../../../assets/hx-boot/hxbot-boot-4x3.mp4"),
  "9x16": require("../../../../assets/hx-boot/hxbot-boot-9x16.mp4"),
};
const FIRST: Record<HxBootAspect, number> = {
  "16x9": require("../../../../assets/hx-boot/hxbot-boot-16x9-first.jpg"),
  "4x3": require("../../../../assets/hx-boot/hxbot-boot-4x3-first.jpg"),
  "9x16": require("../../../../assets/hx-boot/hxbot-boot-9x16-first.jpg"),
};
/** The fade into the app, inside the 300 ms that a skip may take. */
const FADE_MS = 160;
/** The film must have started this soon after it came. */
const START_MS = 1_000;
/** A tap this far into the film goes on. */
const SKIP_AFTER_S = 1;
/** A tap this long after the film came goes on, even if it has not played 1 s (it is stuck). */
const SKIP_ANYWAY_MS = 2_000;
/** The film has had its time this long after it came, whether it ended or not. */
const FILM_CAP_MS = 20_000;

export function HxBootFilm() {
  const { ready, full, sound } = useHxBoot();
  const reducedMotion = useReducedMotion();
  const [gone, setGone] = useState(false);
  if (!ready || !full || reducedMotion || gone) return null;
  return <HxBootFilmPlayer sound={sound} onDone={() => setGone(true)} />;
}

function HxBootFilmPlayer(props: { sound: boolean; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  // The film is chosen once: turning the phone while it plays does not start it again.
  const aspect = useRef(hxBootAspect(width, height)).current;
  const fit = hxBootFit(aspect, width, height);
  const opacity = useRef(new Animated.Value(1)).current;
  const player = useVideoPlayer(FILMS[aspect], (created) => {
    created.muted = !props.sound;
    created.loop = false;
    created.play();
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const started = useRef(false);
  const leaving = useRef(false);
  const cameAt = useRef(Date.now());
  const finished = useRef(props.onDone);
  finished.current = props.onDone;
  /** A tap or the back button: on one second into the film, or two seconds after a film that is stuck. */
  const skip = useRef(() => {
    if (player.currentTime >= SKIP_AFTER_S || Date.now() - cameAt.current >= SKIP_ANYWAY_MS) done.current();
  });
  /** Fades out, then leaves; a second call does nothing. */
  const done = useRef(() => {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => finished.current());
  });

  useEffect(() => {
    if (isPlaying && !started.current) {
      started.current = true;
      void markHxBootPlayed();
    }
  }, [isPlaying]);
  useEffect(() => {
    if (status === "error") done.current();
  }, [status]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!started.current) done.current();
    }, START_MS);
    const cap = setTimeout(() => done.current(), FILM_CAP_MS);
    const ended = player.addListener("playToEnd", () => done.current());
    // While the film shows, the back button is the film's: it goes on one second in, and never takes
    // the app behind the film back.
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (leaving.current) return false;
      skip.current();
      return true;
    });
    return () => {
      clearTimeout(timer);
      clearTimeout(cap);
      ended.remove();
      back.remove();
    };
  }, [player]);

  const placed = { position: "absolute" as const, left: fit.left, top: fit.top, width: fit.width, height: fit.height };
  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: "#ffffff",
        zIndex: 1000,
        overflow: "hidden",
        opacity,
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Pressable style={{ flex: 1 }} onPress={() => skip.current()}>
        <Image source={FIRST[aspect]} style={placed} resizeMode="stretch" />
        <VideoView
          player={player}
          style={[placed, { backgroundColor: "transparent" }]}
          contentFit="fill"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      </Pressable>
    </Animated.View>
  );
}
