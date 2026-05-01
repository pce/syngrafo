/**
 * @file graph_addon.hh
 * @brief Entity-Relationship Graph and Community Detection (Leidenfold) Addon.
 */

#ifndef GRAPH_ADDON_HH
#define GRAPH_ADDON_HH

#include "../nlp_addon_system.hh"
#include <unordered_map>
#include <vector>
#include <string>
#include <cmath>
#include <algorithm>
#include <nlohmann/json.hpp>
#include "vector_addon.hh"

namespace pce::nlp {

using json = nlohmann::json;

/**
 * @struct EntityNode
 * @brief Represents a unique entity (node) in the knowledge graph.
 */
struct EntityNode {
    uint32_t id;
    std::string name;
    std::string type;
    float importance = 0.0f;
    uint32_t community_id = 0;
};

/**
 * @struct EntityEdge
 * @brief A weighted relationship between two entity nodes.
 */
struct EntityEdge {
    uint32_t to;
    float weight = 1.0f;
};

/**
 * @class GraphAddon
 * @brief High-performance Graph Engine for Entity Relationships and Clustering.
 *
 * This addon builds a sparse adjacency graph of co-occurring entities and
 * implements a "Leidenfold" partitioning algorithm to discover thematic
 * communities within the text.
 */
class GraphAddon : public NLPAddon<GraphAddon> {
private:
    std::unordered_map<std::string, uint32_t> name_to_id_;
    std::vector<EntityNode> nodes_;
    std::vector<std::vector<EntityEdge>> adjacency_;
    std::shared_ptr<VectorAddon> vector_engine_;

    std::string name_ = "graph_engine";
    std::string version_ = "1.0.0";

public:
    GraphAddon() = default;

    /** @brief Rule of 5: Modern C++ standards. */
    virtual ~GraphAddon() = default;
    GraphAddon(const GraphAddon&) = default;
    GraphAddon& operator=(const GraphAddon&) = default;
    GraphAddon(GraphAddon&&) noexcept = default;
    GraphAddon& operator=(GraphAddon&&) noexcept = default;

    // --- NLPAddon Implementation ---

    const std::string& name_impl() const { return name_; }
    const std::string& version_impl() const { return version_; }

    bool init_impl() { return true; }
    bool is_ready_impl() const { return !nodes_.empty(); }

    /**
     * @brief Attach a vector engine for semantic similarity based weighting.
     */
    void set_vector_engine(std::shared_ptr<VectorAddon> engine) {
        vector_engine_ = engine;
    }

    /**
     * @brief Adds a relationship between two entities.
     * If nodes don't exist, they are instantiated with their detected types.
     */
    void add_relationship(const std::string& e1, const std::string& e1_type,
                          const std::string& e2, const std::string& e2_type,
                          float weight = 1.0f) {
        uint32_t id1 = get_or_create_node(e1, e1_type);
        uint32_t id2 = get_or_create_node(e2, e2_type);

        if (id1 == id2) return;

        float final_weight = weight;

        // Vector Integration: Boost weight if entities are semantically similar
        if (vector_engine_ && vector_engine_->is_ready_impl()) {
            float sim = vector_engine_->calculate_similarity(e1, e2);
            if (sim > 0.5f) final_weight *= (1.0f + sim);
        }

        update_edge_weight(id1, id2, final_weight);
        update_edge_weight(id2, id1, final_weight);

        nodes_[id1].importance += final_weight;
        nodes_[id2].importance += final_weight;
    }

    /**
     * @brief Leidenfold Community Detection.
     * Includes a movement phase and a refinement phase to break apart oversized communities.
     */
    void detect_communities(int max_iterations = 15) {
        if (nodes_.empty()) return;

        // Initialize: each node starts in its own cluster
        for (auto& node : nodes_) {
            node.community_id = node.id;
        }

        for (int iter = 0; iter < max_iterations; ++iter) {
            bool changed = false;

            // Phase 1: Movement
            for (auto& node : nodes_) {
                uint32_t best_comm = find_optimal_community(node.id);
                if (best_comm != node.community_id) {
                    node.community_id = best_comm;
                    changed = true;
                }
            }

            // Phase 2: Refinement (Leidenfold improvement)
            // Break apart communities with low internal density
            if (iter % 3 == 0) {
                refine_communities();
            }

            if (!changed) break;
        }
    }

    /**
     * @brief Refinement Layer: Checks community density and splits weak clusters.
     */
    void refine_communities() {
        std::unordered_map<uint32_t, std::vector<uint32_t>> communities;
        for (const auto& node : nodes_) {
            communities[node.community_id].push_back(node.id);
        }

        for (auto& [comm_id, members] : communities) {
            if (members.size() < 4) continue;

            float internal_weight = 0.0f;
            for (uint32_t id : members) {
                for (const auto& edge : adjacency_[id]) {
                    if (nodes_[edge.to].community_id == comm_id) {
                        internal_weight += edge.weight;
                    }
                }
            }

            // Density check: if internal connectivity is too low, isolate the least connected node
            float density = internal_weight / (members.size() * (members.size() - 1));
            if (density < 0.05f) {
                uint32_t weakest_node = members[0];
                float min_conn = 1e9f;
                for (uint32_t id : members) {
                    float conn = 0;
                    for (const auto& e : adjacency_[id]) if (nodes_[e.to].community_id == comm_id) conn += e.weight;
                    if (conn < min_conn) { min_conn = conn; weakest_node = id; }
                }
                nodes_[weakest_node].community_id = weakest_node; // Re-isolate
            }
        }
    }

    /**
     * @brief Process graph analytics and return community distributions.
     */
    AddonResponse process_impl(const std::string& input,
                               const std::unordered_map<std::string, std::string>& options,
                               std::shared_ptr<AddonContext> context = nullptr) {
        int iterations = options.contains("iterations") ? std::stoi(options.at("iterations")) : 10;

        if (vector_engine_ && vector_engine_->is_ready_impl()) {
            for (size_t i = 0; i < nodes_.size(); ++i) {
                for (size_t j = i + 1; j < nodes_.size(); ++j) {
                    float sim = vector_engine_->calculate_similarity(nodes_[i].name, nodes_[j].name);
                    if (sim > 0.85f) { // High semantic bridge
                        update_edge_weight(nodes_[i].id, nodes_[j].id, sim * 0.5f);
                        update_edge_weight(nodes_[j].id, nodes_[i].id, sim * 0.5f);
                    }
                }
            }
        }

        detect_communities(iterations);

        json result = json::object();
        json communities = json::object();
        for (const auto& node : nodes_) {
            communities[std::to_string(node.community_id)].push_back({
                {"name", node.name},
                {"type", node.type},
                {"importance", node.importance}
            });
        }
        result["communities"] = communities;

        AddonResponse resp;
        resp.output = result.dump();
        resp.success = true;
        resp.metrics["nodes"] = static_cast<double>(nodes_.size());
        return resp;
    }

    void process_stream_impl(const std::string& input,
                             std::function<void(const std::string& chunk, bool is_final)> callback,
                             const std::unordered_map<std::string, std::string>& options,
                             std::shared_ptr<AddonContext> context = nullptr) {
        AddonResponse resp = process_impl(input, options, context);
        callback(resp.output, true);
    }

private:
    uint32_t get_or_create_node(const std::string& name, const std::string& type) {
        auto it = name_to_id_.find(name);
        if (it != name_to_id_.end()) return it->second;

        uint32_t id = static_cast<uint32_t>(nodes_.size());
        nodes_.push_back({id, name, type, 0.0f, id});
        adjacency_.push_back({});
        name_to_id_[name] = id;
        return id;
    }

    void update_edge_weight(uint32_t from, uint32_t to, float weight) {
        for (auto& edge : adjacency_[from]) {
            if (edge.to == to) {
                edge.weight += weight;
                return;
            }
        }
        adjacency_[from].push_back({to, weight});
    }

    uint32_t find_optimal_community(uint32_t node_id) {
        std::unordered_map<uint32_t, float> community_weights;
        for (const auto& edge : adjacency_[node_id]) {
            uint32_t target_community = nodes_[edge.to].community_id;
            community_weights[target_community] += edge.weight;
        }

        uint32_t best_community = nodes_[node_id].community_id;
        float max_weight = -1.0f;

        for (const auto& [comm, weight] : community_weights) {
            if (weight > max_weight) {
                max_weight = weight;
                best_community = comm;
            }
        }
        return best_community;
    }
};

} // namespace pce::nlp

#endif // GRAPH_ADDON_HH
