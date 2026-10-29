import { render, screen } from "@testing-library/react-native";

import { MessageList } from "../src/components/MessageList";

describe("MessageList", () => {
  it("renders user and assistant messages in order", async () => {
    await render(
      <MessageList
        messages={[
          { id: "1", role: "user", content: "What is the capital of France?" },
          { id: "2", role: "assistant", content: "Paris." },
          { id: "3", role: "user", content: "And Spain?" },
        ]}
      />,
    );

    const bubbles = screen.getAllByTestId("message");

    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toHaveTextContent("What is the capital of France?");
    expect(bubbles[1]).toHaveTextContent("Paris.");
    expect(bubbles[2]).toHaveTextContent("And Spain?");
  });

  it("shows a hint when there are no messages", async () => {
    await render(<MessageList messages={[]} />);

    expect(screen.getByText("Tap the microphone and ask something.")).toBeOnTheScreen();
  });
});
