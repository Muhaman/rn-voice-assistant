import { fireEvent, render, screen } from "@testing-library/react-native";

import { MicButton } from "../src/components/MicButton";

describe("MicButton", () => {
  it("is labelled 'Start listening' when idle", async () => {
    await render(<MicButton state="idle" onPress={jest.fn()} />);

    expect(screen.getByLabelText("Start listening")).toBeOnTheScreen();
  });

  it.each([
    ["listening", "Stop listening"],
    ["thinking", "Thinking"],
    ["speaking", "Stop speaking"],
  ] as const)("is labelled for the %s state", async (state, label) => {
    await render(<MicButton state={state} onPress={jest.fn()} />);

    expect(screen.getByLabelText(label)).toBeOnTheScreen();
  });

  it("calls onPress when pressed", async () => {
    const onPress = jest.fn();
    await render(<MicButton state="idle" onPress={onPress} />);

    await fireEvent.press(screen.getByLabelText("Start listening"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("is disabled and ignores presses while thinking", async () => {
    const onPress = jest.fn();
    await render(<MicButton state="thinking" onPress={onPress} />);

    const button = screen.getByLabelText("Thinking");
    await fireEvent.press(button);

    expect(button).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });
});
