import { useNavigate } from "react-router-dom";
import { v4 as uuidV4 } from "uuid";

function Home() {
  const navigate = useNavigate();

  const createRoom = () => {
    const id = uuidV4(); // unique room ID
    navigate(`/room/${id}`);
  };

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h2>Welcome to Video Chat</h2>
      <button onClick={createRoom}>Create Room</button>
    </div>
  );
}

export default Home;
