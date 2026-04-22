import streamDeck from "@elgato/streamdeck";
import { AppVolumeAction } from "./actions/app-volume.action";
import { ActiveWindowVolumeAction } from "./actions/active-window-volume.action";

streamDeck.actions.registerAction(new AppVolumeAction());
streamDeck.actions.registerAction(new ActiveWindowVolumeAction());

streamDeck.connect();
