import { SerializedTree } from '../../types';

// import for the nodes
import TreeNode from './TreeNode';

const Tree = ({ data, first }: { data: SerializedTree[]; first: boolean }): JSX.Element => {
  // Render section
  return (
    <>
      {/* Checks if the current iteration is the first time being run (adding in ul if not, and without ul if it is the first time) */}
      {first ? (
        data.map((tree: SerializedTree) => {
          return <TreeNode key={tree.id} node={tree} />;
        })
      ) : (
        <ul>
          {data.map((tree: SerializedTree) => {
            return <TreeNode key={tree.id} node={tree} />;
          })}
        </ul>
      )}
    </>
  );
};

export default Tree;
