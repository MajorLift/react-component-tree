import { SerializedTree } from '../../types';

// component imports
import Navbar from './Navbar';
import Tree from './Tree';

const Sidebar = () => {
  // state variables for the incomimg treeData, parsed viewData, user's settings, and the root file name
  const [treeData, setTreeData] = useState<SerializedTree[]>([]);
  const [viewData, setViewData] = useState<SerializedTree[]>([]);

  // useEffect whenever the Sidebar is rendered
  useEffect(() => {
    // Event Listener for 'message' from the extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        // Listener to receive the tree data, update navbar and tree view
        case 'parsed-data': {
          const parsedTree = message.value as SerializedTree;
          setRootFile(parsedTree.fileName);
          setTreeData([parsedTree]);
          break;
        }
        // Listener to receive the user's settings
        case 'settings-data': {
          setSettings(message.value);
          break;
        }
      }
    });

    // Post message to the extension whenever sapling is opened
    tsvscode.postMessage({
      type: 'onSaplingVisible',
      value: null,
    });

    // Post message to the extension for the user's settings whenever sapling is opened
    tsvscode.postMessage({
      type: 'onSettingsAcquire',
      value: null,
    });
  }, []);

  // Separate useEffect that gets triggered when the treeData and settings state variables get updated
  useEffect(() => {
    // Filters component tree nodes based on users settings
    if (treeData.length && settings) {
    // Helper function for the recursive parsing
      const applySettings = (node: SerializedTree): SerializedTree => {
      // Logic to parse the nodes based on the users settings
        return {
          ...node,
          children: node.children
            .filter(
              (child) =>
                (settings.thirdParty && child.isThirdParty && !child.isReactRouter) ||
                (settings.reactRouter && child.isReactRouter) ||
                (!child.isThirdParty && !child.isReactRouter)
            )
            .map((child) => applySettings(child)),
    };
  };
      // Update the viewData state
      setViewData([applySettings(treeData[0])]);
    }
  }, [treeData, settings]);

  // Render section
  return (
    <div className="sidebar">
      <Navbar rootFile={rootFile} />
      <hr className="line_break" />
      <div className="tree_view">
        <ul className="tree_beginning">
          {viewData && settings ? <Tree data={viewData} first={true} /> : null}
        </ul>
      </div>
    </div>
  );
};

export default Sidebar;
